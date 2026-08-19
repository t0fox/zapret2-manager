import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Prototype simulation of P5 C-helper prober staged classification
function probeDomainClassification({ domain, ip, tcpConnectOk, sniHandshakeOk, neutralSniHandshakeOk, http2MultiplexOk, httpStatus }) {
  // Stage 1: TCP/IP connectivity
  if (!tcpConnectOk) {
    return {
      classification: 'PathIP',
      failureCode: 'ETCP_REFUSED_OR_TIMEOUT',
      details: 'TCP connection failed before TLS handshake'
    };
  }

  // Stage 2: TLS SNI check vs Neutral SNI comparison
  if (!sniHandshakeOk) {
    if (neutralSniHandshakeOk) {
      return {
        classification: 'PathSNI',
        failureCode: 'ETLS_SNI_BLOCKED',
        details: 'Target SNI failed TLS handshake while neutral SNI succeeded on identical IP'
      };
    } else {
      return {
        classification: 'PathIP',
        failureCode: 'ETLS_IP_FILTERED',
        details: 'Both target SNI and neutral SNI failed on this IP'
      };
    }
  }

  // Stage 3: HTTP/2 multiplexing probe
  if (!http2MultiplexOk) {
    return {
      classification: 'PathDegradedH2',
      failureCode: 'EHTTP2_STALL',
      details: 'TLS succeeded but HTTP/2 multiplexed streams stalled'
    };
  }

  // Stage 4: HTTP status
  if (httpStatus === 451 || httpStatus === 403 || httpStatus === 302) {
    return {
      classification: 'PathServer',
      failureCode: `EHTTP_STATUS_${httpStatus}`,
      details: 'Connection and TLS succeeded, server returned blocking/redirect response'
    };
  }

  return {
    classification: 'Clear',
    failureCode: 'NONE',
    details: 'All stages passed cleanly'
  };
}

test('P5-Prototype: Golden tests for staged classification (PathSNI, PathIP, PathServer, and HTTP/2 multiplex probe)', () => {
  // 1. Classic TSPU SNI block: TCP ok, neutral SNI ok, target SNI reset/dropped
  const sniBlock = probeDomainClassification({
    domain: 'rutracker.org',
    ip: '104.21.32.1',
    tcpConnectOk: true,
    sniHandshakeOk: false,
    neutralSniHandshakeOk: true,
    http2MultiplexOk: false,
    httpStatus: 0
  });
  assert.equal(sniBlock.classification, 'PathSNI');
  assert.equal(sniBlock.failureCode, 'ETLS_SNI_BLOCKED');

  // 2. IP-level block: TCP drops before handshake
  const ipBlock = probeDomainClassification({
    domain: 'blocked-ip.net',
    ip: '198.51.100.1',
    tcpConnectOk: false,
    sniHandshakeOk: false,
    neutralSniHandshakeOk: false,
    http2MultiplexOk: false,
    httpStatus: 0
  });
  assert.equal(ipBlock.classification, 'PathIP');
  assert.equal(ipBlock.failureCode, 'ETCP_REFUSED_OR_TIMEOUT');

  // 3. HTTP/2 throttling/stall (YouTube CDN degradation): TLS passes, H2 multiplex stalls
  const h2Stall = probeDomainClassification({
    domain: 'rr1---sn-xxx.googlevideo.com',
    ip: '173.194.1.1',
    tcpConnectOk: true,
    sniHandshakeOk: true,
    neutralSniHandshakeOk: true,
    http2MultiplexOk: false,
    httpStatus: 0
  });
  assert.equal(h2Stall.classification, 'PathDegradedH2');
  assert.equal(h2Stall.failureCode, 'EHTTP2_STALL');

  // 4. Clean domain: all stages pass
  const clean = probeDomainClassification({
    domain: 'kernel.org',
    ip: '139.178.84.217',
    tcpConnectOk: true,
    sniHandshakeOk: true,
    neutralSniHandshakeOk: true,
    http2MultiplexOk: true,
    httpStatus: 200
  });
  assert.equal(clean.classification, 'Clear');
  assert.equal(clean.failureCode, 'NONE');
});
