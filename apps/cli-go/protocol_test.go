package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"testing"
)

func TestFramingRoundTrip(t *testing.T) {
	b := frame(`{"jsonrpc":"2.0","id":1,"result":{"ok":true}}`)
	payload, err := readMessage(bufio.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != `{"jsonrpc":"2.0","id":1,"result":{"ok":true}}` {
		t.Fatalf("payload = %s", payload)
	}
}

func TestClientConsumesEventBeforeResponse(t *testing.T) {
	var wire bytes.Buffer
	_ = writeMessage(&wire, []byte(`{"jsonrpc":"2.0","method":"meta-prompt.phase.progress","params":{"message":"working"}}`))
	_ = writeMessage(&wire, []byte(`{"jsonrpc":"2.0","id":1,"result":{"status":"success"}}`))
	var seen Notification
	c := NewClient(&wire, &bytes.Buffer{}, func(n Notification) { seen = n })
	var result map[string]string
	if err := c.Call(context.Background(), "run/start", nil, &result); err != nil {
		t.Fatal(err)
	}
	if seen.Method != "meta-prompt.phase.progress" || result["status"] != "success" {
		t.Fatalf("event=%+v result=%v", seen, result)
	}
}

func TestClientWritesFramedRequest(t *testing.T) {
	var out bytes.Buffer
	response := frame(`{"jsonrpc":"2.0","id":1,"result":null}`)
	c := NewClient(response, &out, nil)
	var ignored interface{}
	if err := c.Call(context.Background(), "initialize", map[string]string{"version": "1"}, &ignored); err != nil {
		t.Fatal(err)
	}
	payload, err := readMessage(bufio.NewReader(&out))
	if err != nil {
		t.Fatalf("%v (wire=%q)", err, out.String())
	}
	var request rpcRequest
	if json.Unmarshal(payload, &request) != nil || request.Method != "initialize" || request.ID != 1 {
		t.Fatalf("request = %s", payload)
	}
}
