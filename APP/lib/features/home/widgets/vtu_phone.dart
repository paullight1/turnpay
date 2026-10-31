/// Prefix suggestions use NCC's mobile allocation table, checked 2026-10-30:
/// https://old.ncc.gov.ng/technical-regulation/standards/numbering
/// A prefix identifies the original allocation, not a ported number's network.
class VtuPhone {
  static String normalize(String raw) {
    final value = raw.trim().replaceAll(RegExp(r'[\s()\-]'), '');
    if (RegExp(r'^\+?234[789]\d{9}$').hasMatch(value)) {
      return '0${value.replaceFirst(RegExp(r'^\+?234'), '')}';
    }
    return value;
  }

  static bool isValid(String raw) =>
      RegExp(r'^0[789]\d{9}$').hasMatch(normalize(raw));

  static String? suggest(String raw) {
    final phone = normalize(raw);
    if (!isValid(phone)) return null;
    final prefix = phone.substring(0, 4);
    for (final entry in _prefixes.entries) {
      if (entry.value.contains(prefix)) return entry.key;
    }
    // Unallocated/unknown prefixes require an explicit network selection.
    return null;
  }

  static const _prefixes = {
    'mtn': {
      '0703',
      '0704',
      '0706',
      '0707',
      '0803',
      '0806',
      '0810',
      '0813',
      '0814',
      '0816',
      '0903',
      '0906',
      '0913',
      '0916'
    },
    'airtel': {
      '0701',
      '0708',
      '0802',
      '0808',
      '0812',
      '0901',
      '0902',
      '0904',
      '0907',
      '0911',
      '0912'
    },
    'glo': {'0705', '0805', '0807', '0811', '0815', '0905', '0915'},
    '9mobile': {'0809', '0817', '0818', '0908', '0909'},
  };
}
