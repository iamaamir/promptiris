---
status: accepted
---

# Use portable exact text selectors

Text Patches and Protected Spans will share a revision-bound selector containing a stable block ID, zero-based half-open Unicode scalar-value range, exact quote, and optional prefix/suffix evidence, with endpoints restricted to extended grapheme boundaries. UTF-16 units privilege JavaScript, byte offsets are awkward for text consumers, and grapheme indexes vary with segmentation data, while exact code-point selection is portable and can still prohibit splitting user-perceived characters.

## Consequences

The SDK and test kit must provide conversion and conformance utilities for TypeScript, Go, and editor coordinates. Stale selectors or quote mismatches fail deterministically; prefix/suffix never authorize fuzzy Plugin mutation.
