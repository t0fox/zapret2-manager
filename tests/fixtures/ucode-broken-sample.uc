// BROKEN ucode sample for the gate-ucode-compile self-test.
// Deliberately UNBALANCED (one more opening brace than closing) — this is the
// same class of defect the real watchdog.uc carries (an unclosed brace). The
// compile gate must catch it (ucode -c returns non-zero). Do NOT ship this
// file and do NOT run the other gates against it — it is a self-test fixture only.
// Name prefix 'ucode-broken-' so any glob over shipped .uc skips it.

function broken() {
	if (true) {
		// missing closing brace: this function never closes its if-block
		print("hello\n");
}
