package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type selectorFixture struct {
	Name            string       `json:"name"`
	Text            string       `json:"text"`
	CurrentRevision int          `json:"currentRevision"`
	Selector        TextSelector `json:"selector"`
	ScalarValid     bool         `json:"scalarValid"`
	GraphemeValid   bool         `json:"graphemeValid"`
}

type overlapFixture struct {
	Name       string       `json:"name"`
	Protection TextSelector `json:"protection"`
	Edit       TextSelector `json:"edit"`
	Expected   bool         `json:"expected"`
}

type rebaseFixture struct {
	Name         string       `json:"name"`
	Selector     TextSelector `json:"selector"`
	Edit         TextSelector `json:"edit"`
	Replacement  string       `json:"replacement"`
	NextRevision int          `json:"nextRevision"`
	Expected     TextSelector `json:"expected"`
}

type transformationFixture struct {
	SelectorCases []selectorFixture `json:"selectorCases"`
	OverlapCases  []overlapFixture  `json:"overlapCases"`
	RebaseCases   []rebaseFixture   `json:"rebaseCases"`
}

func loadTransformationFixture(t *testing.T) transformationFixture {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("..", "..", "spec", "fixtures", "transformation-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture transformationFixture
	if err := json.Unmarshal(content, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func TestTransformationSelectorFixtures(t *testing.T) {
	for _, fixture := range loadTransformationFixture(t).SelectorCases {
		t.Run(fixture.Name, func(t *testing.T) {
			err := validateSelector(fixture.Text, fixture.CurrentRevision, fixture.Selector)
			if fixture.ScalarValid != (err == nil) {
				t.Fatalf("scalarValid=%v err=%v", fixture.ScalarValid, err)
			}
		})
	}
}

func TestTransformationOverlapFixtures(t *testing.T) {
	for _, fixture := range loadTransformationFixture(t).OverlapCases {
		if actual := selectorsOverlap(fixture.Protection, fixture.Edit); actual != fixture.Expected {
			t.Errorf("%s: overlap=%v", fixture.Name, actual)
		}
	}
}

func TestTransformationRebaseFixtures(t *testing.T) {
	for _, fixture := range loadTransformationFixture(t).RebaseCases {
		actual, err := RebaseSelector(
			fixture.Selector,
			fixture.Edit,
			fixture.Replacement,
			fixture.NextRevision,
		)
		if err != nil || !reflect.DeepEqual(actual, fixture.Expected) {
			t.Errorf("%s: actual=%+v expected=%+v err=%v", fixture.Name, actual, fixture.Expected, err)
		}
	}
}

func TestOffsetRejections(t *testing.T) {
	if _, err := ByteToScalarOffset("🚀", 1); err == nil {
		t.Fatal("accepted byte offset inside rune")
	}
	if _, err := ScalarToByteOffset("abc", 4); err == nil {
		t.Fatal("accepted out-of-range scalar")
	}
}

func TestOffsetRoundTrip(t *testing.T) {
	const text = "go 🚀 now"
	for scalar := 0; scalar <= len([]rune(text)); scalar++ {
		byteOffset, err := ScalarToByteOffset(text, scalar)
		if err != nil {
			t.Fatal(err)
		}
		actual, err := ByteToScalarOffset(text, byteOffset)
		if err != nil || actual != scalar {
			t.Fatalf("scalar=%d actual=%d err=%v", scalar, actual, err)
		}
	}
}
