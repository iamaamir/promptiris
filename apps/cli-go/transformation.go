package main

import (
	"errors"
	"fmt"
	"unicode/utf8"
)

// TextSelector is the portable representation used by patches and protections.
// Range offsets count Unicode scalar values, not bytes or UTF-16 code units.
type TextSelector struct {
	BlockID  string `json:"blockId"`
	Revision int    `json:"revision"`
	Range    struct {
		Unit  string `json:"unit"`
		Start int    `json:"start"`
		End   int    `json:"end"`
	} `json:"range"`
	Quote struct {
		Exact  string `json:"exact"`
		Prefix string `json:"prefix,omitempty"`
		Suffix string `json:"suffix,omitempty"`
	} `json:"quote"`
}

// ScalarToByteOffset converts a scalar offset to a Go string byte offset.
func ScalarToByteOffset(text string, scalar int) (int, error) {
	if scalar < 0 {
		return 0, errors.New("scalar offset must be non-negative")
	}
	if !utf8.ValidString(text) {
		return 0, errors.New("text is not valid UTF-8")
	}
	if scalar == 0 {
		return 0, nil
	}
	count := 0
	for i := range text {
		if count == scalar {
			return i, nil
		}
		count++
	}
	if count == scalar {
		return len(text), nil
	}
	return 0, fmt.Errorf("scalar offset %d outside text (%d scalars)", scalar, count)
}

// ByteToScalarOffset converts a Go string byte offset to a scalar offset.
// Offsets inside a UTF-8 encoding are rejected rather than rounded.
func ByteToScalarOffset(text string, byteOffset int) (int, error) {
	if byteOffset < 0 || byteOffset > len(text) {
		return 0, errors.New("byte offset outside text")
	}
	if !utf8.ValidString(text) {
		return 0, errors.New("text is not valid UTF-8")
	}
	if byteOffset > 0 && byteOffset < len(text) && !utf8.RuneStart(text[byteOffset]) {
		return 0, errors.New("byte offset splits a UTF-8 scalar")
	}
	return len([]rune(text[:byteOffset])), nil
}

func validateSelector(text string, currentRevision int, selector TextSelector) error {
	if selector.Revision != currentRevision {
		return errors.New("selector revision is stale")
	}
	if selector.Range.Unit != "unicode-scalar" || selector.Range.Start < 0 || selector.Range.End < selector.Range.Start {
		return errors.New("invalid selector range")
	}
	start, err := ScalarToByteOffset(text, selector.Range.Start)
	if err != nil {
		return err
	}
	end, err := ScalarToByteOffset(text, selector.Range.End)
	if err != nil {
		return err
	}
	if text[start:end] != selector.Quote.Exact {
		return errors.New("selector quote mismatch")
	}
	if selector.Quote.Prefix != "" && !hasTextSuffix(text[:start], selector.Quote.Prefix) {
		return errors.New("selector prefix mismatch")
	}
	if selector.Quote.Suffix != "" && !hasTextPrefix(text[end:], selector.Quote.Suffix) {
		return errors.New("selector suffix mismatch")
	}
	return nil
}

func hasTextPrefix(text, prefix string) bool {
	return len(prefix) <= len(text) && text[:len(prefix)] == prefix
}

func hasTextSuffix(text, suffix string) bool {
	return len(suffix) <= len(text) && text[len(text)-len(suffix):] == suffix
}

func selectorsOverlap(a, b TextSelector) bool {
	return a.BlockID == b.BlockID && a.Range.Start < b.Range.End && b.Range.Start < a.Range.End
}

// RebaseSelector shifts an active selector after a non-overlapping edit.
func RebaseSelector(selector TextSelector, edit TextSelector, replacement string, nextRevision int) (TextSelector, error) {
	if selectorsOverlap(selector, edit) {
		return TextSelector{}, errors.New("selector overlaps edit")
	}
	selector.Revision = nextRevision
	if selector.BlockID != edit.BlockID {
		return selector, nil
	}
	delta := len([]rune(replacement)) - (edit.Range.End - edit.Range.Start)
	if edit.Range.End <= selector.Range.Start {
		selector.Range.Start += delta
		selector.Range.End += delta
	}
	return selector, nil
}
