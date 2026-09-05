// Repository-contained gate for launch-time mobile hardening that still
// depends on platform adapters or operator-managed trust material.
//
// This unconfigured implementation remains a safe sentinel for callers that
// have no adapter. The actual API transport now uses secure_transport_factory
// (SHA256 leaf certificate DER pins, not SPKI) and device_integrity_service
// (local signals, not server attestation). Deployment trust material, rotation
// and physical-device evidence must still be verified independently.

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
