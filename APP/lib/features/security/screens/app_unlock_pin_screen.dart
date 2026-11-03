import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/theme/app_theme.dart';
import '../../../services/transaction_security_service.dart';

/// Manages this device's app-unlock credential. Never calls the payment API.
class AppUnlockPinScreen extends StatefulWidget {
  final TransactionSecurityService securityService;
  final TransactionSecurityConfig config;
  const AppUnlockPinScreen(
      {super.key, required this.securityService, required this.config});
  @override
  State<AppUnlockPinScreen> createState() => _AppUnlockPinScreenState();
}

class _AppUnlockPinScreenState extends State<AppUnlockPinScreen> {
  String _digits = '';
  String? _replacement;
  String? _error;
  bool _currentApproved = false;
  bool _busy = false;
  bool get _needsProof => !_currentApproved && widget.config.hasAppLock;
  int get _length =>
      _needsProof && widget.config.hasPin ? widget.config.pinLength : 6;

  Future<void> _phoneProof() async {
    if (_busy) return;
    setState(() => _busy = true);
    final approved = await widget.securityService.authenticateBiometric(
        reason: 'Confirm changes to TrustPay app unlock');
    if (!mounted) return;
    setState(() {
      _busy = false;
      _currentApproved = approved;
      _error = approved ? null : 'Phone security was not confirmed. Try again.';
    });
  }

  Future<void> _digit(String digit) async {
    if (_busy || (_needsProof && !widget.config.hasPin)) return;
    setState(() {
      _error = null;
      _digits += digit;
    });
    if (_digits.length != _length) return;
    final entered = _digits;
    setState(() => _busy = true);
    try {
      if (_needsProof) {
        final result =
            await widget.securityService.verifyPinWithLockout(entered);
        if (!mounted) return;
        setState(() {
          _currentApproved = result.approved;
          _error = result.approved
              ? null
              : result.lockedOut
                  ? 'App unlock is temporarily locked. Use account-password recovery on the lock screen.'
                  : 'Incorrect app-unlock PIN. Try again.';
        });
      } else if (_replacement == null) {
        setState(() => _replacement = entered);
      } else if (_replacement != entered) {
        setState(() =>
            _error = 'PINs do not match. Enter your new app-unlock PIN again.');
      } else {
        await widget.securityService.savePin(entered, pinLength: 6);
        if (!mounted) return;
        Navigator.of(context).pop(true);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not update app unlock. Try again.');
      }
    } finally {
      if (mounted) {
        setState(() {
          _digits = '';
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    AppColors.watch(context);
    final osProof = _needsProof && !widget.config.hasPin;
    return PopScope(
        canPop: !_busy,
        child: Scaffold(
          backgroundColor: AppColors.background,
          appBar: AppBar(
              title: const Text('App unlock'),
              automaticallyImplyLeading: !_busy),
          body: SafeArea(
              child: LayoutBuilder(
                  builder: (context, viewport) => SingleChildScrollView(
                      child: ConstrainedBox(
                          constraints:
                              BoxConstraints(minHeight: viewport.maxHeight),
                          child: Center(
                              child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 400),
                            child: Padding(
                                padding: const EdgeInsets.all(24),
                                child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(Icons.phonelink_lock_outlined,
                                          size: 44, color: AppColors.primary),
                                      const SizedBox(height: 24),
                                      Text(
                                          _needsProof
                                              ? 'Confirm app unlock'
                                              : _replacement == null
                                                  ? 'Create app-unlock PIN'
                                                  : 'Confirm app-unlock PIN',
                                          textAlign: TextAlign.center,
                                          style: AppTextStyles.headingL),
                                      const SizedBox(height: 12),
                                      Text(
                                          _needsProof
                                              ? 'Use your current app-unlock method to continue.'
                                              : 'A 6-digit code for unlocking TrustPay on this device. Your transaction PIN stays separate.',
                                          textAlign: TextAlign.center,
                                          style: AppTextStyles.bodyM),
                                      const SizedBox(height: 32),
                                      if (!osProof)
                                        Semantics(
                                            label:
                                                '${_digits.length} of $_length digits entered',
                                            child: Row(
                                                mainAxisAlignment:
                                                    MainAxisAlignment.center,
                                                children: List.generate(
                                                    _length,
                                                    (i) => Container(
                                                        margin: const EdgeInsets
                                                            .all(6),
                                                        width: 16,
                                                        height: 16,
                                                        decoration: BoxDecoration(
                                                            shape:
                                                                BoxShape.circle,
                                                            color: i <
                                                                    _digits
                                                                        .length
                                                                ? AppColors
                                                                    .primary
                                                                : AppColors
                                                                    .border))))),
                                      if (_error != null)
                                        Padding(
                                            padding: const EdgeInsets.symmetric(
                                                vertical: 16),
                                            child: Semantics(
                                                liveRegion: true,
                                                child: Text(_error!,
                                                    textAlign: TextAlign.center,
                                                    style: TextStyle(
                                                        color:
                                                            AppColors.error)))),
                                      if (_busy)
                                        const Padding(
                                            padding: EdgeInsets.all(16),
                                            child: LinearProgressIndicator()),
                                      if (osProof)
                                        FilledButton.icon(
                                            onPressed:
                                                _busy ? null : _phoneProof,
                                            style: FilledButton.styleFrom(
                                                minimumSize:
                                                    const Size.fromHeight(56)),
                                            icon: const Icon(
                                                Icons.verified_user_outlined),
                                            label: const Text(
                                                'Use phone security'))
                                      else
                                        Padding(
                                            padding:
                                                const EdgeInsets.only(top: 24),
                                            child: GridView(
                                                gridDelegate:
                                                    const SliverGridDelegateWithFixedCrossAxisCount(
                                                        crossAxisCount: 3,
                                                        mainAxisExtent: 64,
                                                        mainAxisSpacing: 12,
                                                        crossAxisSpacing: 12),
                                                shrinkWrap: true,
                                                physics:
                                                    const NeverScrollableScrollPhysics(),
                                                children: [
                                                  for (final digit in [
                                                    '1',
                                                    '2',
                                                    '3',
                                                    '4',
                                                    '5',
                                                    '6',
                                                    '7',
                                                    '8',
                                                    '9'
                                                  ])
                                                    TextButton(
                                                        onPressed: _busy
                                                            ? null
                                                            : () {
                                                                HapticFeedback
                                                                    .selectionClick();
                                                                _digit(digit);
                                                              },
                                                        child: Text(digit,
                                                            style: AppTextStyles
                                                                .headingL)),
                                                  const SizedBox.shrink(),
                                                  TextButton(
                                                      onPressed: _busy
                                                          ? null
                                                          : () => _digit('0'),
                                                      child: Text('0',
                                                          style: AppTextStyles
                                                              .headingL)),
                                                  IconButton(
                                                      tooltip: 'Delete digit',
                                                      onPressed: _busy ||
                                                              _digits.isEmpty
                                                          ? null
                                                          : () => setState(() =>
                                                              _digits = _digits
                                                                  .substring(
                                                                      0,
                                                                      _digits.length -
                                                                          1)),
                                                      icon: const Icon(Icons
                                                          .backspace_outlined)),
                                                ])),
                                    ])),
                          )))))),
        ));
  }
}
