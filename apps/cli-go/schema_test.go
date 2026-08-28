package main

import (
	"encoding/json"
	"testing"
)

func TestRunResultSchemaValidation(t *testing.T) {
	valid := json.RawMessage(`{
		"schemaVersion":"1","runId":"run-1",
		"recipe":{"id":"meta-prompt/identity","version":"1.0.0"},"status":"success",
		"primary":{"schemaVersion":"1","id":"artifact:identity","kind":"meta-prompt/prompt",
			"mediaType":"text/plain","value":"input","classification":"public",
			"provenance":{"pluginId":"meta-prompt/core","contributionId":"identity",
				"invocationId":"run-1:identity","phase":"render","parentArtifactIds":[],"patchIds":[]}},
		"primaryOrigin":"original",
		"alternatives":[],"exposed":{},"assumptions":[],"clarifications":[],
		"diagnostics":[],"summary":{"traceId":"run-1","durationMs":0,
			"completedPhases":["transform"],"failedPhases":[]}
	}`)
	if err := validateRunResult(valid); err != nil {
		t.Fatalf("valid Run Result rejected: %v", err)
	}
	if err := validateRunResult(json.RawMessage(`{"schemaVersion":"1"}`)); err == nil {
		t.Fatal("incomplete Run Result accepted")
	}
	if err := validateRunResult(json.RawMessage(`{`)); err == nil {
		t.Fatal("malformed JSON accepted")
	}
}
