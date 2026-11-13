# October 2026 payroll release

`payroll` is the normalized PAYEMS row from the Field Data capture on 2026-11-13 at 12:57:00 UTC (dataset `b8b72337671b57109efaa808c5ab8d8ddb7cf6097477f36f9b50bc544daaca88`). The [original BLS release](https://www.bls.gov/news.release/archives/empsit_11062026.htm) reports the same +165,000 seasonally adjusted change. `calendar` is the pinned `/v1/calendar` record for the same release.

`event` retains the schedule and −0.1973% BTC reaction from the live `/cube/strip` answer on 2026-11-13 (field snapshot `2583071883b13a310589705d48c63cb32cc2f77d9362ab343645a26cbaca3ec0`). Its `payrolls` field came from running the updated Cube bridge against the new Field Data publication. The browser uses this captured release with a fixture clock to exercise the exact replay edge.
