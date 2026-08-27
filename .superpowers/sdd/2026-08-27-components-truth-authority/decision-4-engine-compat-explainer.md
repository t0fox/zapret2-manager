# Decision 4 — stock-compatibility explain of 128 strategies

Generated from zapret2-manager/files/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json
(machine-readable requirements after the Task-6 per-token rework).

## Summary

| class | count | meaning |
|---|---|---|
| ENGINE_NATIVE | 0 | requires a native C delta absent in stock bol-van — **must be zero before Task 31** |
| Z2K_LUA | 10 | relies on Z2K Core Lua assets (engine-independent; satisfied by Z2K exact-managed runtime + z2m sidecars) |
| BLOB | 74 | needs extra fake-packet blobs delivered by manager asset materialization, not by the engine archive |
| STOCK_OK | 44 | no requirements at all beyond stock binaries + stock Lua |

**Engine-native blockers: 0 — gate value required: 0.**

## Per-strategy table

| strategy id | class | declared requirements → actual reason |
|---|---|---|
| rkn_tcp_strat_1 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| rkn_tcp_strat_3 | BLOB | dependency/blob: tls_clienthello_4pda_to |
| rkn_tcp_strat_8 | BLOB | dependency/blob: tls_clienthello_activated |
| rkn_tcp_strat_9 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| rkn_tcp_strat_10 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| rkn_tcp_strat_11 | BLOB | dependency/blob: stun,tls_clienthello_www_google_com |
| rkn_tcp_strat_12 | BLOB | dependency/blob: tls_clienthello_www_onetrust_com,tls_clienthello_vk_com,tls_clienthello_gosuslugi_ru |
| rkn_tcp_strat_13 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| rkn_tcp_strat_14 | BLOB | dependency/blob: t2,tls_clienthello_vk_com,tls_clienthello_gosuslugi_ru |
| rkn_tcp_strat_16 | BLOB | dependency/blob: tls_clienthello_www_onetrust_com |
| rkn_tcp_strat_17 | BLOB | dependency/blob: stun,tls_clienthello_www_google_com |
| rkn_tcp_strat_18 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| rkn_tcp_strat_19 | BLOB | dependency/blob: syn_packet |
| rkn_tcp_strat_20 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| rkn_tcp_strat_21 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| rkn_tcp_strat_23 | BLOB | dependency/blob: stun,tls_clienthello_4pda_to |
| rkn_tcp_strat_24 | BLOB | dependency/blob: stun,tls_max_ru |
| rkn_tcp_strat_25 | BLOB | dependency/blob: stun,tls_clienthello_www_google_com |
| rkn_tcp_strat_26 | BLOB | dependency/blob: stun,tls_clienthello_www_google_com |
| rkn_tcp_strat_27 | BLOB | dependency/blob: stun,tls_max_ru |
| rkn_tcp_strat_29 | BLOB | dependency/blob: stun,tls_max_ru |
| rkn_tcp_strat_30 | BLOB | dependency/blob: tls_clienthello_14 |
| rkn_tcp_strat_31 | BLOB | dependency/blob: tls_max_ru |
| rkn_tcp_strat_32 | BLOB | dependency/blob: syn_packet |
| rkn_tcp_strat_33 | BLOB | dependency/blob: tls_clienthello_4pda_to |
| rkn_tcp_strat_34 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| rkn_tcp_strat_36 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| rkn_tcp_strat_37 | BLOB | dependency/blob: tls_clienthello_www_google_com,tls_clienthello_vk_com,tls_clienthello_gosuslugi_ru |
| rkn_tcp_strat_46 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| rkn_tcp_strat_47 | BLOB | dependency/blob: tls_clienthello_www_onetrust_com,tls_clienthello_vk_com,tls_clienthello_gosuslugi_ru |
| rkn_tcp_strat_49 | BLOB | dependency/blob: tls_clienthello_14 |
| rkn_tcp_strat_50 | BLOB | dependency/blob: syn_packet |
| yt_tcp_strat_3 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| yt_tcp_strat_4 | BLOB | dependency/blob: tls_clienthello_www_onetrust_com |
| yt_tcp_strat_5 | BLOB | dependency/blob: tls_clienthello_www_onetrust_com,tls_clienthello_vk_com,tls_clienthello_gosuslugi_ru |
| yt_tcp_strat_7 | BLOB | dependency/blob: stun,tls_max_ru |
| yt_tcp_strat_8 | BLOB | dependency/blob: tls_clienthello_14 |
| yt_tcp_strat_9 | BLOB | dependency/blob: tls_max_ru |
| yt_tcp_strat_11 | BLOB | dependency/blob: syn_packet |
| yt_tcp_strat_12 | BLOB | dependency/blob: tls_clienthello_4pda_to |
| yt_tcp_strat_13 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| yt_tcp_strat_15 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| yt_tcp_strat_16 | BLOB | dependency/blob: tls_clienthello_www_google_com,tls_clienthello_vk_com,tls_clienthello_gosuslugi_ru |
| yt_tcp_strat_17 | BLOB | dependency/blob: tls_max_ru,tls_clienthello_activated |
| yt_tcp_strat_21 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| gv_tcp_strat_2 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| gv_tcp_strat_3 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| gv_tcp_strat_4 | BLOB | dependency/blob: tls_clienthello_www_onetrust_com |
| gv_tcp_strat_5 | BLOB | dependency/blob: tls_clienthello_www_onetrust_com,tls_clienthello_vk_com,tls_clienthello_gosuslugi_ru |
| gv_tcp_strat_7 | BLOB | dependency/blob: stun,tls_max_ru |
| gv_tcp_strat_8 | BLOB | dependency/blob: tls_clienthello_14 |
| gv_tcp_strat_9 | BLOB | dependency/blob: tls_max_ru |
| gv_tcp_strat_13 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| gv_tcp_strat_14 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| gv_tcp_strat_15 | BLOB | dependency/blob: tls_clienthello_www_google_com |
| gv_tcp_strat_16 | BLOB | dependency/blob: tls_clienthello_www_google_com,tls_clienthello_vk_com,tls_clienthello_gosuslugi_ru |
| gv_tcp_strat_17 | BLOB | dependency/blob: tls_max_ru,tls_clienthello_activated |
| yt_quic_strat_1 | BLOB | dependency/blob: quic_google |
| yt_quic_strat_2 | BLOB | dependency/blob: quic_google |
| yt_quic_strat_3 | BLOB | dependency/blob: quic_google |
| yt_quic_strat_4 | BLOB | dependency/blob: quic5 |
| yt_quic_strat_5 | BLOB | dependency/blob: quic4 |
| yt_quic_strat_6 | BLOB | dependency/blob: quic4 |
| yt_quic_strat_7 | BLOB | dependency/blob: quic5 |
| yt_quic_strat_8 | BLOB | dependency/blob: quic1 |
| yt_quic_strat_9 | BLOB | dependency/blob: quic6 |
| yt_quic_fallback_strat_5 | BLOB | dependency/blob: quic5 |
| yt_quic_fallback_strat_6 | BLOB | dependency/blob: quic5 |
| yt_quic_fallback_strat_7 | BLOB | dependency/blob: quic5 |
| discord_voice_strat_4 | BLOB | dependency/blob: quic_google |
| discord_voice_strat_5 | BLOB | dependency/blob: quic5 |
| discord_voice_strat_7 | BLOB | dependency/blob: quic5 |
| discord_voice_strat_9 | BLOB | dependency/blob: quic5 |
| discord_voice_strat_10 | BLOB | dependency/blob: quic5 |
| rkn_tcp_strat_2 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_4 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_5 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_6 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_7 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_15 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_22 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_28 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_35 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_38 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_39 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_40 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_41 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_42 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_43 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_44 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_45 | STOCK_OK | fully stock-compatible |
| rkn_tcp_strat_48 | STOCK_OK | fully stock-compatible |
| yt_tcp_strat_1 | STOCK_OK | fully stock-compatible |
| yt_tcp_strat_2 | STOCK_OK | fully stock-compatible |
| yt_tcp_strat_6 | STOCK_OK | fully stock-compatible |
| yt_tcp_strat_10 | STOCK_OK | fully stock-compatible |
| yt_tcp_strat_14 | STOCK_OK | fully stock-compatible |
| yt_tcp_strat_18 | STOCK_OK | fully stock-compatible |
| yt_tcp_strat_19 | STOCK_OK | fully stock-compatible |
| yt_tcp_strat_20 | STOCK_OK | fully stock-compatible |
| yt_tcp_strat_22 | STOCK_OK | fully stock-compatible |
| gv_tcp_strat_1 | STOCK_OK | fully stock-compatible |
| gv_tcp_strat_6 | STOCK_OK | fully stock-compatible |
| gv_tcp_strat_10 | STOCK_OK | fully stock-compatible |
| gv_tcp_strat_11 | STOCK_OK | fully stock-compatible |
| gv_tcp_strat_12 | STOCK_OK | fully stock-compatible |
| gv_tcp_strat_18 | STOCK_OK | fully stock-compatible |
| gv_tcp_strat_19 | STOCK_OK | fully stock-compatible |
| gv_tcp_strat_20 | STOCK_OK | fully stock-compatible |
| gv_tcp_strat_21 | STOCK_OK | fully stock-compatible |
| gv_tcp_strat_22 | STOCK_OK | fully stock-compatible |
| yt_quic_fallback_strat_4 | STOCK_OK | fully stock-compatible |
| yt_quic_fallback_strat_8 | STOCK_OK | fully stock-compatible |
| yt_quic_fallback_strat_9 | STOCK_OK | fully stock-compatible |
| yt_quic_fallback_strat_10 | STOCK_OK | fully stock-compatible |
| discord_voice_strat_6 | STOCK_OK | fully stock-compatible |
| discord_voice_strat_11 | STOCK_OK | fully stock-compatible |
| discord_voice_strat_12 | STOCK_OK | fully stock-compatible |
| yt_quic_fallback_strat_1 | Z2K_LUA | Z2K Lua/runtime asset (arg references z2k_* helper) |
| yt_quic_fallback_strat_2 | Z2K_LUA | Z2K Lua/runtime asset (arg references z2k_* helper) |
| yt_quic_fallback_strat_3 | Z2K_LUA | Z2K Lua/runtime asset (arg references z2k_* helper) |
| yt_quic_fallback_strat_11 | Z2K_LUA | Z2K Lua/runtime asset: z2k_quic_morph_v2 |
| yt_quic_fallback_strat_12 | Z2K_LUA | Z2K Lua/runtime asset: z2k_quic_morph_v2 |
| yt_quic_fallback_strat_13 | Z2K_LUA | Z2K Lua/runtime asset: z2k_timing_morph |
| discord_voice_strat_1 | Z2K_LUA | Z2K Lua/runtime asset: z2k_quic_morph_v2 |
| discord_voice_strat_2 | Z2K_LUA | Z2K Lua/runtime asset: z2k_timing_morph |
| discord_voice_strat_3 | Z2K_LUA | Z2K Lua/runtime asset: z2k_quic_morph_v2 |
| discord_voice_strat_8 | Z2K_LUA | Z2K Lua/runtime asset (arg references z2k_* helper) |
