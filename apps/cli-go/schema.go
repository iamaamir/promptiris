package main

import (
	_ "embed"
	"encoding/json"
	"fmt"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed schemas/run-result.schema.json
var runResultSchemaDocument []byte

var compiledRunResultSchema = mustCompileRunResultSchema()

func mustCompileRunResultSchema() *jsonschema.Schema {
	var document any
	if err := json.Unmarshal(runResultSchemaDocument, &document); err != nil {
		panic(fmt.Sprintf("decode embedded Run Result schema: %v", err))
	}
	compiler := jsonschema.NewCompiler()
	compiler.DefaultDraft(jsonschema.Draft2020)
	const schemaURL = "urn:promptiris:schema:run-result:v1"
	if err := compiler.AddResource(schemaURL, document); err != nil {
		panic(fmt.Sprintf("register embedded Run Result schema: %v", err))
	}
	return compiler.MustCompile(schemaURL)
}

func validateRunResult(raw json.RawMessage) error {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	return compiledRunResultSchema.Validate(value)
}
