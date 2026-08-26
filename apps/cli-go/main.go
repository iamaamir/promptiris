package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

type promptDocument struct {
	SchemaVersion string      `json:"schemaVersion"`
	Content       []textBlock `json:"content"`
}

type textBlock struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type runResult struct {
	SchemaVersion string    `json:"schemaVersion"`
	Status        string    `json:"status"`
	Primary       *artifact `json:"primary,omitempty"`
	Diagnostics   []diag    `json:"diagnostics,omitempty"`
}

type artifact struct {
	Value interface{} `json:"value"`
}

type diag struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Title    string `json:"title"`
}

type initializeResult struct {
	ProtocolVersion string                 `json:"protocolVersion"`
	Capabilities    map[string]interface{} `json:"capabilities"`
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := runCLIContext(ctx, os.Args[1:], os.Stdin, os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "meta-prompt:", err)
		os.Exit(1)
	}
}

func runCLI(args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	return runCLIContext(context.Background(), args, stdin, stdout, stderr)
}

func runCLIContext(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	command := newRootCommand(stdin, stdout, stderr)
	command.SetArgs(args)
	return command.ExecuteContext(ctx)
}

func newRootCommand(stdin io.Reader, stdout, stderr io.Writer) *cobra.Command {
	root := &cobra.Command{
		Use:           "meta-prompt",
		Short:         "Transform prompts through the Meta Prompt runtime",
		SilenceErrors: true,
		SilenceUsage:  true,
		RunE: func(command *cobra.Command, _ []string) error {
			return command.Help()
		},
	}
	root.SetIn(stdin)
	root.SetOut(stdout)
	root.SetErr(stderr)

	var runtimePath string
	var input string
	var strict bool
	enhance := &cobra.Command{
		Use:   "enhance [text]",
		Short: "Run the bundled identity tracer Recipe",
		Args:  cobra.ArbitraryArgs,
		RunE: func(command *cobra.Command, args []string) error {
			text := input
			if text == "" && len(args) > 0 {
				text = strings.Join(args, " ")
			}
			if text == "" {
				value, err := io.ReadAll(command.InOrStdin())
				if err != nil {
					return err
				}
				text = string(value)
			}
			if runtimePath == "" {
				return errors.New("runtime is required (--runtime or META_PROMPT_RUNTIME)")
			}
			return execute(command.Context(), runtimePath, text, strict, command.OutOrStdout(), command.ErrOrStderr())
		},
	}
	enhance.Flags().StringVar(&runtimePath, "runtime", os.Getenv("META_PROMPT_RUNTIME"), "path to bundled Node runtime entrypoint")
	enhance.Flags().StringVar(&input, "input", "", "prompt text (otherwise stdin or positional text)")
	enhance.Flags().BoolVar(&strict, "strict", false, "return non-zero on transformation failure")
	root.AddCommand(enhance)
	return root
}

func execute(ctx context.Context, runtimePath, text string, strict bool, stdout, stderr io.Writer) error {
	cmd, err := runtimeCommand(runtimePath)
	if err != nil {
		return err
	}
	child := exec.CommandContext(ctx, cmd[0], append(cmd[1:], "--stdio")...)
	child.Stderr = stderr
	stdin, err := child.StdinPipe()
	if err != nil {
		return err
	}
	childStdout, err := child.StdoutPipe()
	if err != nil {
		return err
	}
	if err := child.Start(); err != nil {
		return fmt.Errorf("start runtime: %w", err)
	}
	defer func() {
		_ = stdin.Close()
		_ = child.Process.Kill()
		_ = child.Wait()
	}()

	var runID string
	client := NewClient(childStdout, stdin, func(notification Notification) {
		if notification.Method != "run/event" {
			return
		}
		var event struct {
			Type  string `json:"type"`
			RunID string `json:"runId"`
			Data  struct {
				Phase  string `json:"phase"`
				Status string `json:"status"`
			} `json:"data"`
		}
		if json.Unmarshal(notification.Params, &event) != nil {
			return
		}
		if event.RunID != "" {
			runID = event.RunID
		}
		if event.Type == "meta-prompt.phase.started" {
			fmt.Fprintf(stderr, "%s: started\n", event.Data.Phase)
		}
		if event.Type == "meta-prompt.phase.completed" {
			fmt.Fprintf(stderr, "%s: %s\n", event.Data.Phase, event.Data.Status)
		}
	})
	var init initializeResult
	if err := client.Call(ctx, "initialize", map[string]interface{}{
		"protocolVersion": "1",
		"clientName":      "meta-prompt-cli/0.1.0",
		"capabilities":    map[string]bool{"events": true, "cancellation": true},
	}, &init); err != nil {
		return fmt.Errorf("initialize: %w", err)
	}
	var rawResult json.RawMessage
	doc := promptDocument{"1", []textBlock{{"input", text}}}
	if err := client.Call(ctx, "run/start", map[string]interface{}{
		"recipe": "builtin.identity",
		"input":  doc,
	}, &rawResult); err != nil {
		if runID != "" {
			_ = client.notify("run/cancel", map[string]string{"runId": runID})
		}
		return fmt.Errorf("run identity: %w", err)
	}
	if err := validateRunResult(rawResult); err != nil {
		return fmt.Errorf("validate run result: %w", err)
	}
	var result runResult
	if err := json.Unmarshal(rawResult, &result); err != nil {
		return fmt.Errorf("decode run result: %w", err)
	}
	var shutdownResult interface{}
	if err := client.Call(ctx, "shutdown", nil, &shutdownResult); err != nil {
		return fmt.Errorf("shutdown runtime: %w", err)
	}
	if result.Primary == nil {
		if strict || result.Status == "blocked" {
			return errors.New("runtime returned no primary artifact")
		}
		return nil
	}
	var output string
	if s, ok := result.Primary.Value.(string); ok {
		output = s
	} else {
		b, err := json.Marshal(result.Primary.Value)
		if err != nil {
			return fmt.Errorf("encode primary artifact: %w", err)
		}
		output = string(b)
	}
	if _, err := io.WriteString(stdout, output); err != nil {
		return err
	}
	if !strings.HasSuffix(output, "\n") {
		_, _ = io.WriteString(stdout, "\n")
	}
	if strict && (result.Status == "failed" || result.Status == "degraded") {
		return fmt.Errorf("runtime returned status %q", result.Status)
	}
	return nil
}

func runtimeCommand(path string) ([]string, error) {
	if filepath.Ext(path) == ".mjs" || filepath.Ext(path) == ".js" {
		node := os.Getenv("META_PROMPT_NODE")
		if node == "" {
			node = "node"
		}
		return []string{node, path}, nil
	}
	return []string{path}, nil
}
