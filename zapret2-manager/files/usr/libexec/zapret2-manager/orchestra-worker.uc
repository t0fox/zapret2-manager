#!/usr/bin/ucode
'use strict';
import { orchestra_worker_control_run } from './orchestra-worker-control.uc';
if (!ARGV[0]) exit(64);
orchestra_worker_control_run(ARGV[0]);
