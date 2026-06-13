import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../widgets/main_shell.dart';
import '../../features/auth/screens/splash_screen.dart';
import '../../features/auth/screens/onboarding_screen.dart';
import '../../features/auth/screens/login_screen.dart';
import '../../features/auth/screens/register_screen.dart';
import '../../features/auth/screens/otp_screen.dart';
import '../../features/auth/screens/forgot_password_screen.dart';
import '../../features/home/screens/dashboard_detail_screen.dart';
import '../../features/home/screens/home_task_screen.dart';
import '../../features/home/screens/send_money_entry_screen.dart';
import '../../features/home/screens/kyc_verification_screen.dart';
import '../../features/home/screens/money_action_screen.dart';
import '../../features/home/screens/withdrawal_authorization_screen.dart';
import '../../features/home/screens/withdrawal_receipt_screen.dart';
import '../../features/security/screens/transaction_security_screen.dart';
import '../../features/wallet/screens/wallet_detail_screen.dart';
import '../../features/wallet/screens/receive_money_screen.dart';
import '../../features/transactions/screens/transaction_detail_screen.dart';

// ─── ROUTE NAMES ──────────────────────────────────────────────────────────────
class AppRoutes {
  static const splash = '/';
  static const onboarding = '/onboarding';
  static const login = '/login';
  static const register = '/register';
  static const otp = '/otp';
  static const forgotPassword = '/forgot-password';
  static const home = '/home';
  static const notifications = '/notifications';
  static const kyc = '/kyc';
  static const fund = '/fund';
  static const send = '/send';
  static const sendTrustpay = '/send/trustpay';
  static const sendBank = '/send/bank';
  static const withdraw = '/withdraw';
  static const withdrawAuthorize = '/withdraw/authorize/:reference';
  static const withdrawSuccess = '/withdraw/success';
  static const withdrawReceipt = '/withdraw/receipt/:reference';
  static const exchange = '/exchange';
  static const exchangeSettlement = '/exchange/settlement';
  static const airtime = '/airtime';
  static const data = '/data';
  static const electricity = '/electricity';
  static const bills = electricity;
  static const wallets = '/wallets';
  static const virtualAccount = '/virtual-account';
  static const activity = '/activity';
  static const vtuOrder = '/vtu/order/:reference';
  static const more = '/more';
  static const profileAccount = '/profile/account';
  static const profileAppearance = '/profile/appearance';
  static const profileSecurity = '/profile/security';
  static const transactionSecurity = '/profile/security/transaction-security';
  static const profileSupport = '/profile/support';
  static const walletDetail = '/wallet/:currency';
  static const receiveMoney = '/receive-money';
  static const transactionDetail = '/transaction/:reference';

  static String vtuOrderFor(String reference) {
    return '/vtu/order/${Uri.encodeComponent(reference)}';
  }

  static String walletDetailFor(String currency) {
    return '/wallet/${Uri.encodeComponent(currency)}';
  }

  static String transactionDetailFor(String reference) {
    return '/transaction/${Uri.encodeComponent(reference)}';
  }

  static String withdrawAuthorizeFor(String reference) {
    return '/withdraw/authorize/${Uri.encodeComponent(reference)}';
  }

  static String withdrawReceiptFor(String reference) {
    return '/withdraw/receipt/${Uri.encodeComponent(reference)}';
  }
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: AppRoutes.splash,
    debugLogDiagnostics: kDebugMode,
    routes: [
      GoRoute(
        path: AppRoutes.splash,
        pageBuilder: (context, state) => _fadeTransition(
          state,
          const SplashScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.home,
        pageBuilder: (context, state) => _fadeTransition(
          state,
          const MainShell(),
        ),
      ),
      GoRoute(
        path: AppRoutes.notifications,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const DashboardDetailScreen(kind: DashboardDetailKind.notifications),
        ),
      ),
      GoRoute(
        path: AppRoutes.profileAccount,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const ProfileActionScreen(kind: ProfileActionKind.account),
        ),
      ),
      GoRoute(
        path: AppRoutes.profileAppearance,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const ProfileActionScreen(kind: ProfileActionKind.appearance),
        ),
      ),
      GoRoute(
        path: AppRoutes.profileSecurity,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const ProfileActionScreen(kind: ProfileActionKind.security),
        ),
      ),
      GoRoute(
        path: AppRoutes.transactionSecurity,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const TransactionSecurityScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.profileSupport,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const ProfileActionScreen(kind: ProfileActionKind.support),
        ),
      ),
      GoRoute(
        path: AppRoutes.kyc,
        builder: (context, state) => const KycVerificationScreen(),
      ),
      GoRoute(
        path: AppRoutes.fund,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const MoneyActionScreen(kind: MoneyActionKind.fund),
        ),
      ),
      GoRoute(
        path: AppRoutes.send,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const SendMoneyEntryScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.sendTrustpay,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const MoneyActionScreen(kind: MoneyActionKind.send),
        ),
      ),
      GoRoute(
        path: AppRoutes.sendBank,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const MoneyActionScreen(kind: MoneyActionKind.withdraw),
        ),
      ),
      GoRoute(
        path: AppRoutes.withdraw,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const MoneyActionScreen(kind: MoneyActionKind.withdraw),
        ),
      ),
      GoRoute(
        path: AppRoutes.withdrawAuthorize,
        pageBuilder: (context, state) => _slideTransition(
          state,
          WithdrawalAuthorizationScreen(
            key: state.pageKey,
            reference: Uri.decodeComponent(
              state.pathParameters['reference'] ?? '',
            ),
          ),
        ),
      ),
      GoRoute(
        path: AppRoutes.withdrawSuccess,
        pageBuilder: (context, state) => _slideTransition(
          state,
          WithdrawalCompletionScreen(
            key: state.pageKey,
            details: _withdrawalCompletionDetailsFromExtra(state.extra),
          ),
        ),
      ),
      GoRoute(
        path: AppRoutes.withdrawReceipt,
        pageBuilder: (context, state) => _slideTransition(
          state,
          WithdrawalReceiptScreen(
            key: state.pageKey,
            reference: Uri.decodeComponent(
              state.pathParameters['reference'] ?? '',
            ),
            details: _withdrawalCompletionDetailsFromExtra(state.extra),
          ),
        ),
      ),
      GoRoute(
        path: AppRoutes.exchange,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const MoneyActionScreen(kind: MoneyActionKind.exchange),
        ),
      ),
      GoRoute(
        path: AppRoutes.exchangeSettlement,
        pageBuilder: (context, state) {
          final receipt = state.extra as ExchangeReceipt?;
          return _slideTransition(
            state,
            ExchangeSettlementScreen(receipt: receipt),
          );
        },
      ),
      GoRoute(
        path: AppRoutes.airtime,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const MoneyActionScreen(kind: MoneyActionKind.airtime),
        ),
      ),
      GoRoute(
        path: AppRoutes.data,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const MoneyActionScreen(kind: MoneyActionKind.data),
        ),
      ),
      GoRoute(
        path: AppRoutes.electricity,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const MoneyActionScreen(kind: MoneyActionKind.electricity),
        ),
      ),
      GoRoute(
        path: AppRoutes.wallets,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const DashboardDetailScreen(kind: DashboardDetailKind.wallets),
        ),
      ),
      GoRoute(
        path: AppRoutes.virtualAccount,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const DashboardDetailScreen(kind: DashboardDetailKind.virtualAccount),
        ),
      ),
      GoRoute(
        path: AppRoutes.activity,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const DashboardDetailScreen(kind: DashboardDetailKind.activity),
        ),
      ),
      GoRoute(
        path: AppRoutes.vtuOrder,
        pageBuilder: (context, state) => _slideTransition(
          state,
          VtuOrderDetailScreen(
            reference: Uri.decodeComponent(
              state.pathParameters['reference'] ?? '',
            ),
          ),
        ),
      ),
      GoRoute(
        path: AppRoutes.more,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const HomeTaskScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.onboarding,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const OnboardingScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.login,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const LoginScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.register,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const RegisterScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.otp,
        pageBuilder: (context, state) {
          final extra = state.extra as Map<String, dynamic>? ?? {};
          return _slideTransition(
            state,
            OtpScreen(
              phone: extra['phone'] as String? ?? '',
              purpose: extra['purpose'] as String? ?? 'verify',
            ),
          );
        },
      ),
      GoRoute(
        path: AppRoutes.forgotPassword,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const ForgotPasswordScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.walletDetail,
        pageBuilder: (context, state) => _slideTransition(
          state,
          WalletDetailScreen(
            currency: Uri.decodeComponent(
              state.pathParameters['currency'] ?? 'NGN',
            ),
          ),
        ),
      ),
      GoRoute(
        path: AppRoutes.receiveMoney,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const ReceiveMoneyScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.transactionDetail,
        pageBuilder: (context, state) => _slideTransition(
          state,
          TransactionDetailScreen(
            reference: Uri.decodeComponent(
              state.pathParameters['reference'] ?? '',
            ),
          ),
        ),
      ),
    ],
  );
});

// ─── PAGE TRANSITION HELPERS ──────────────────────────────────────────────────
CustomTransitionPage<void> _fadeTransition(
  GoRouterState state,
  Widget child,
) {
  return CustomTransitionPage<void>(
    key: state.pageKey,
    child: child,
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      return FadeTransition(opacity: animation, child: child);
    },
    transitionDuration: const Duration(milliseconds: 400),
  );
}

WithdrawalCompletionDetails? _withdrawalCompletionDetailsFromExtra(
  Object? extra,
) {
  if (extra is WithdrawalCompletionDetails) {
    return extra;
  }

  if (extra is! Map) {
    return null;
  }

  final data = Map<String, dynamic>.from(extra);
  final metadata = _asMap(data['metadata']);
  final attempts = _asList(data['transferAttempts']);
  final latestAttempt = attempts.isNotEmpty ? _asMap(attempts.first) : {};
  final attemptMetadata = _asMap(latestAttempt['metadata']);
  final status = _asString(data['status'], fallback: 'PENDING');

  return WithdrawalCompletionDetails(
    reference: _asString(data['reference']),
    status: status,
    message: _asString(data['message']),
    amount: _asString(data['amount'], fallback: '0.00'),
    currency: _asString(data['currency'], fallback: 'NGN'),
    bankName: _asString(
      attemptMetadata['bankName'],
      fallback: _asString(metadata['bankName'], fallback: 'Bank'),
    ),
    accountName: _asString(
      attemptMetadata['accountName'],
      fallback: _asString(metadata['accountName'], fallback: 'Account'),
    ),
    accountNumberMasked: _asString(
      attemptMetadata['accountNumberMasked'],
      fallback: _asString(
        metadata['accountNumberMasked'],
        fallback: '******',
      ),
    ),
    providerStatus: _asString(
      latestAttempt['providerStatus'],
      fallback: status,
    ),
    providerReference: _asString(
      latestAttempt['providerReference'],
      fallback: _asString(
        metadata['providerTransactionReference'],
        fallback: _asString(data['reference']),
      ),
    ),
    createdAt: _asDateTime(data['createdAt']),
    updatedAt: _asDateTime(data['updatedAt']),
    providerCreatedAt: _asDateTime(latestAttempt['createdAt']),
  );
}

Map<String, dynamic> _asMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return const {};
}

List<dynamic> _asList(dynamic value) {
  if (value is List) return value;
  return const [];
}

String _asString(dynamic value, {String fallback = ''}) {
  if (value == null) return fallback;
  final text = value.toString().trim();
  return text.isEmpty ? fallback : text;
}

DateTime? _asDateTime(dynamic value) {
  if (value is DateTime) return value;
  if (value is String && value.trim().isNotEmpty) {
    return DateTime.tryParse(value);
  }
  return null;
}

CustomTransitionPage<void> _slideTransition(
  GoRouterState state,
  Widget child,
) {
  return CustomTransitionPage<void>(
    key: state.pageKey,
    child: child,
    transitionsBuilder: (context, animation, secondaryAnimation, child) =>
        child,
    transitionDuration: Duration.zero,
  );
}
