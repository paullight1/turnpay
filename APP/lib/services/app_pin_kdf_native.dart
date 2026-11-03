import 'package:flutter/foundation.dart';
import 'app_pin_kdf_common.dart';

Future<String> deriveAppPinHash(String pin, List<int> salt) =>
    compute(deriveAppPinHashSync, (pin, salt));
