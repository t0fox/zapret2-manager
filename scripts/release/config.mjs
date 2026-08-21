export const releaseConfig = Object.freeze({
  repository: 't0fox/zapret2-manager',
  manifestSchema: 'zapret2-manager.release-build.v1',
  openwrt: Object.freeze({
    version: '25.12.5',
    target: 'mediatek',
    subtarget: 'filogic',
    sdkFilename: 'openwrt-sdk-25.12.5-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64.tar.zst',
    sdkUrl: 'https://downloads.openwrt.org/releases/25.12.5/targets/mediatek/filogic/openwrt-sdk-25.12.5-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64.tar.zst',
    sdkSha256: 'ff4a38a397caa2cfe1c39e18f84ddede14878221b3593c3f2c4cfe24e3ec4c25'
  }),
  packages: Object.freeze([
    'zapret2-manager',
    'luci-app-zapret2-manager',
    'zapret2-manager-full'
  ]),
  excludedOptionalPackages: Object.freeze(['tg-ws-proxy-go', 'tg-ws-proxy-rs']),
  installation: Object.freeze({
    trustMode: 'allow-untrusted',
    engineBundled: false,
    telegramProxyBundled: false
  })
});
