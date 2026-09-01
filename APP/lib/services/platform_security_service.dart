/// Repository-contained gate for launch-time mobile hardening that still
/// depends on platform adapters or operator-managed trust material.
///
/// This file intentionally does NOT invent certificate pins, root-detection
/// heuristics, or provider secrets. Production enforcement should be wired only
/// after the app has:
/// 1. A platform HTTP adapter that can bind to SPKI/certificate pins.
/// 2. A vetted Android/iOS device-integrity implementation.
/// 3. An operational rotation runbook for replacing pins without downtime.

enum DeviceIntegrityRisk {
  unavailable,
  trusted,
  stepUpRequired,
  blocked,
}

class PlatformSecurityStatus {
  const PlatformSecurityStatus({
    required this.hasProductionCertificatePinning,
    required this.supportsDeviceIntegritySignals,
    required this.deviceIntegrityRisk,
    required this.summary,
  });

  final bool hasProductionCertificatePinning;
  final bool supportsDeviceIntegritySignals;
  final DeviceIntegrityRisk deviceIntegrityRisk;
  final String summary;
}

abstract class PlatformSecurityService {
  Future<PlatformSecurityStatus> getStatus();
}

class UnconfiguredPlatformSecurityService implements PlatformSecurityService {
  const UnconfiguredPlatformSecurityService();

  @override
  Future<PlatformSecurityStatus> getStatus() async {
    return const PlatformSecurityStatus(
      hasProductionCertificatePinning: false,
      supportsDeviceIntegritySignals: false,
      deviceIntegrityRisk: DeviceIntegrityRisk.unavailable,
      summary:
          'Pending platform adapter wiring for certificate pinning and device integrity signals.',
    );
  }
}
