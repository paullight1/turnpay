/// Unknown tiers never grant access. Numeric strings support older API payloads.
int kycTierRank(Object? value) {
  final match = RegExp(r'^(?:TIER_)?([0-3])$')
      .firstMatch('${value ?? ''}'.trim().toUpperCase());
  return match == null ? 0 : int.parse(match.group(1)!);
}
