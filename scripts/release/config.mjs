export const releaseConfig = Object.freeze({
  repository: 't0fox/zapret2-manager',
  manifestSchema: 'zapret2-manager.release-build.v2',
  openwrt: Object.freeze({
    version: '25.12.5',
    target: 'mediatek',
    subtarget: 'filogic',
    sdkFilename: 'openwrt-sdk-25.12.5-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64.tar.zst',
    sdkUrl: 'https://downloads.openwrt.org/releases/25.12.5/targets/mediatek/filogic/openwrt-sdk-25.12.5-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64.tar.zst',
    sdkSha256: 'ff4a38a397caa2cfe1c39e18f84ddede14878221b3593c3f2c4cfe24e3ec4c25'
  }),
  packages: Object.freeze(['zapret2-manager-full']),
  externalDependencies: Object.freeze([
    'ucode',
    'ucode-mod-fs',
    'ucode-mod-io',
    'ucode-mod-socket',
    'ucode-mod-uloop',
    'luci-base',
    'kmod-nfnetlink-queue',
    'kmod-nft-queue',
    'ncat',
    'flock',
    'uclient-fetch',
    'ca-bundle',
    'unzip',
    'jsonfilter',
    'libjson-c'
  ]),
  excludedOptionalPackages: Object.freeze(['tg-ws-proxy-go', 'tg-ws-proxy-rs']),
  bundled: Object.freeze({
    backend: true,
    luci: true,
    z2mRuntime: true,
    engine: false,
    telegramProxy: false
  }),
  compatibility: Object.freeze({
    provides: Object.freeze(['zapret2-manager', 'luci-app-zapret2-manager']),
    legacyPackages: Object.freeze(['zapret2-manager', 'luci-app-zapret2-manager'])
  }),
  installation: Object.freeze({
    trustMode: 'allow-untrusted',
    engineBundled: false,
    telegramProxyBundled: false
  })
});
