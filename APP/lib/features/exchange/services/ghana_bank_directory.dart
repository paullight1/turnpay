/// Ghanaian banks listed in the Bank of Ghana's registered-institutions
/// directory. This list is for destination display/search only.
///
/// The current payout contract does not publish Ghana bank codes and the
/// active Kora capability response reports bank payouts as unsupported. Keep
/// this directory deliberately code-free: a bank name is not evidence that a
/// provider can resolve or pay an account.
class GhanaBankOption {
  final String name;
  final String monogram;
  final int markColorValue;

  String? get logoAsset => _ghanaBankLogoAssets[name];

  const GhanaBankOption({
    required this.name,
    required this.monogram,
    required this.markColorValue,
  });
}

/// Source: Bank of Ghana, Registered Institutions → Banks.
/// https://www.bog.gov.gh/supervision-regulation/registered-institutions/banks/
///
/// Retrieved 2026-11-02. These are names, not provider routing codes.
const ghanaLicensedBanks = <GhanaBankOption>[
  GhanaBankOption(
    name: 'Absa Bank Ghana LTD',
    monogram: 'AB',
    markColorValue: 0xffa6192e,
  ),
  GhanaBankOption(
    name: 'Access Bank (Ghana) Plc',
    monogram: 'AC',
    markColorValue: 0xffed1c24,
  ),
  GhanaBankOption(
    name: 'Agricultural Development Bank Plc',
    monogram: 'AD',
    markColorValue: 0xff006b3f,
  ),
  GhanaBankOption(
    name: 'Bank of Africa Ghana Limited',
    monogram: 'BOA',
    markColorValue: 0xff00529b,
  ),
  GhanaBankOption(
    name: 'CalBank PLC',
    monogram: 'CB',
    markColorValue: 0xffe32b2f,
  ),
  GhanaBankOption(
    name: 'Consolidated Bank Ghana Limited',
    monogram: 'CBG',
    markColorValue: 0xff006b3f,
  ),
  GhanaBankOption(
    name: 'Ecobank Ghana Plc',
    monogram: 'ECO',
    markColorValue: 0xff005b9a,
  ),
  GhanaBankOption(
    name: 'Fidelity Bank (Ghana) LTD',
    monogram: 'FB',
    markColorValue: 0xff006b3f,
  ),
  GhanaBankOption(
    name: 'First Atlantic Bank PLC',
    monogram: 'FA',
    markColorValue: 0xff0073a8,
  ),
  GhanaBankOption(
    name: 'First Bank (Ghana) LTD',
    monogram: 'FBN',
    markColorValue: 0xff005a36,
  ),
  GhanaBankOption(
    name: 'First National Bank (Ghana) Limited',
    monogram: 'FNB',
    markColorValue: 0xff007749,
  ),
  GhanaBankOption(
    name: 'GCB Bank Plc',
    monogram: 'GCB',
    markColorValue: 0xfff2a900,
  ),
  GhanaBankOption(
    name: 'Guaranty Trust Bank (Ghana) LTD',
    monogram: 'GT',
    markColorValue: 0xffed1c24,
  ),
  GhanaBankOption(
    name: 'National Investment Bank PLC',
    monogram: 'NIB',
    markColorValue: 0xff004b87,
  ),
  GhanaBankOption(
    name: 'OmniBSIC Bank Ghana LTD',
    monogram: 'OB',
    markColorValue: 0xff004b87,
  ),
  GhanaBankOption(
    name: 'Prudential Bank Limited',
    monogram: 'PB',
    markColorValue: 0xff005a36,
  ),
  GhanaBankOption(
    name: 'Republic Bank (Ghana) PLC',
    monogram: 'RB',
    markColorValue: 0xff006b3f,
  ),
  GhanaBankOption(
    name: 'Société Générale Ghana Plc',
    monogram: 'SG',
    markColorValue: 0xffe30613,
  ),
  GhanaBankOption(
    name: 'Stanbic Bank Ghana Limited',
    monogram: 'SB',
    markColorValue: 0xff003b70,
  ),
  GhanaBankOption(
    name: 'Standard Chartered Bank Ghana Plc',
    monogram: 'SC',
    markColorValue: 0xff00a9ce,
  ),
  GhanaBankOption(
    name: 'United Bank for Africa (Ghana) Limited',
    monogram: 'UBA',
    markColorValue: 0xffd71920,
  ),
  GhanaBankOption(
    name: 'Universal Merchant Bank Ghana LTD',
    monogram: 'UMB',
    markColorValue: 0xff006b3f,
  ),
  GhanaBankOption(
    name: 'Zenith Bank (Ghana) Limited',
    monogram: 'ZB',
    markColorValue: 0xffed1c24,
  ),
];

String normalizedBankSearchText(String value) =>
    value.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), ' ').trim();

List<GhanaBankOption> searchGhanaBanks(String query) {
  final normalized = normalizedBankSearchText(query);
  if (normalized.isEmpty) return ghanaLicensedBanks;
  return ghanaLicensedBanks
      .where((bank) => normalizedBankSearchText(bank.name).contains(normalized))
      .toList(growable: false);
}

const _ghanaBankLogoAssets = <String, String>{
  'Absa Bank Ghana LTD': 'assets/images/ghana_banks/absa.png',
  'Access Bank (Ghana) Plc': 'assets/images/ghana_banks/access.png',
  'Agricultural Development Bank Plc': 'assets/images/ghana_banks/adb.png',
  'Bank of Africa Ghana Limited': 'assets/images/ghana_banks/boa.png',
  'CalBank PLC': 'assets/images/ghana_banks/calbank.png',
  'Consolidated Bank Ghana Limited': 'assets/images/ghana_banks/cbg.png',
  'Ecobank Ghana Plc': 'assets/images/ghana_banks/ecobank.png',
  'Fidelity Bank (Ghana) LTD': 'assets/images/ghana_banks/fidelity.png',
  'First Atlantic Bank PLC': 'assets/images/ghana_banks/first-atlantic.png',
  'First Bank (Ghana) LTD': 'assets/images/ghana_banks/fbn-bank.png',
  'First National Bank (Ghana) Limited': 'assets/images/ghana_banks/fnb.png',
  'GCB Bank Plc': 'assets/images/ghana_banks/gcb.png',
  'Guaranty Trust Bank (Ghana) LTD': 'assets/images/ghana_banks/gtco.svg',
  'National Investment Bank PLC': 'assets/images/ghana_banks/nib.png',
  'OmniBSIC Bank Ghana LTD': 'assets/images/ghana_banks/omnibsic.png',
  'Prudential Bank Limited': 'assets/images/ghana_banks/prudential.png',
  'Republic Bank (Ghana) PLC': 'assets/images/ghana_banks/republic.png',
  'Société Générale Ghana Plc':
      'assets/images/ghana_banks/societe-generale.png',
  'Stanbic Bank Ghana Limited': 'assets/images/ghana_banks/stanbic.png',
  'Standard Chartered Bank Ghana Plc':
      'assets/images/ghana_banks/standard-chartered.png',
  'United Bank for Africa (Ghana) Limited': 'assets/images/ghana_banks/uba.png',
  'Universal Merchant Bank Ghana LTD': 'assets/images/ghana_banks/umb.png',
  'Zenith Bank (Ghana) Limited': 'assets/images/ghana_banks/zenith.png',
};
