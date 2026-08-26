package main

import (
	"encoding/json"
	"testing"
)

func TestRunResultSchemaValidation(t *testing.T) {
	valid := json.RawMessage(`{
		"schemaVersion":"1","runId":"run-1","recipe":{},"status":"success",
		"alternatives":[],"exposed":{},"assumptions":[],"clarifications":[],
		"diagnostics":[],"summary":{}
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
