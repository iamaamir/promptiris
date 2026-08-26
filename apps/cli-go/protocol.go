package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
)

const maxMessageSize = 8 << 20

var ErrMessageTooLarge = errors.New("json-rpc message exceeds 8 MiB")

// readMessage reads one UTF-8 JSON-RPC message using the protocol's
// Content-Length framing. Headers are deliberately strict: stdout is a wire,
// not a best-effort stream.
func readMessage(r *bufio.Reader) ([]byte, error) {
	var length int
	seenLength := false
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
		if line == "" {
			if !seenLength {
				return nil, errors.New("missing Content-Length header")
			}
			break
		}
		name, value, ok := strings.Cut(line, ":")
		if !ok || !strings.EqualFold(strings.TrimSpace(name), "Content-Length") {
			continue
		}
		n, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || n < 0 {
			return nil, errors.New("invalid Content-Length header")
		}
		if n > maxMessageSize {
			return nil, ErrMessageTooLarge
		}
		length, seenLength = n, true
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func writeMessage(w io.Writer, payload []byte) error {
	if len(payload) > maxMessageSize {
		return ErrMessageTooLarge
	}
	header := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(payload))
	if _, err := io.WriteString(w, header); err != nil {
		return err
	}
	_, err := w.Write(payload)
	return err
}

type rpcRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      uint64      `json:"id"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      uint64          `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

type Notification struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type Client struct {
	r *bufio.Reader
	w io.Writer

	writeMu sync.Mutex
	nextID  uint64
	onEvent func(Notification)
}

func NewClient(r io.Reader, w io.Writer, onEvent func(Notification)) *Client {
	return &Client{r: bufio.NewReader(r), w: w, nextID: 1, onEvent: onEvent}
}

func (c *Client) notify(method string, params interface{}) error {
	b, err := json.Marshal(struct {
		JSONRPC string      `json:"jsonrpc"`
		Method  string      `json:"method"`
		Params  interface{} `json:"params,omitempty"`
	}{"2.0", method, params})
	if err != nil {
		return err
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return writeMessage(c.w, b)
}

func (c *Client) Call(ctx context.Context, method string, params interface{}, out interface{}) error {
	c.writeMu.Lock()
	id := c.nextID
	c.nextID++
	b, err := json.Marshal(rpcRequest{"2.0", id, method, params})
	if err == nil {
		err = writeMessage(c.w, b)
	}
	c.writeMu.Unlock()
	if err != nil {
		return err
	}

	// Reads are intentionally serialized: one stdio peer has one ordered wire.
	// A caller can cancel the child (the CLI does so) if a blocked read cannot
	// be interrupted by the underlying pipe.
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		message, err := readMessage(c.r)
		if err != nil {
			return err
		}
		var envelope struct {
			JSONRPC string          `json:"jsonrpc"`
			ID      *uint64         `json:"id"`
			Method  string          `json:"method"`
			Params  json.RawMessage `json:"params,omitempty"`
		}
		if err := json.Unmarshal(message, &envelope); err != nil {
			return fmt.Errorf("invalid JSON-RPC message: %w", err)
		}
		if envelope.Method != "" && envelope.ID == nil {
			if c.onEvent != nil {
				c.onEvent(Notification{envelope.JSONRPC, envelope.Method, envelope.Params})
			}
			continue
		}
		if envelope.ID == nil || *envelope.ID != id {
			return fmt.Errorf("unexpected JSON-RPC response id")
		}
		var response rpcResponse
		if err := json.Unmarshal(message, &response); err != nil {
			return err
		}
		if response.Error != nil {
			return fmt.Errorf("JSON-RPC error %d: %s", response.Error.Code, response.Error.Message)
		}
		if out != nil && len(response.Result) != 0 {
			return json.Unmarshal(response.Result, out)
		}
		return nil
	}
}

// frame is exported to tests in this package and keeps framing behavior easy
// to exercise without launching a process.
func frame(payload string) *bytes.Buffer {
	var b bytes.Buffer
	_ = writeMessage(&b, []byte(payload))
	return &b
}
