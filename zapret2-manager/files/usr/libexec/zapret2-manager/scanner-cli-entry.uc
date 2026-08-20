'use strict';

import { scanner_cli_request } from './scanner-cli.uc';

if (ARGV[0] != null) {
	let output = scanner_cli_request(ARGV[0], ARGV[1]);
	print(sprintf('%J', output));
}
