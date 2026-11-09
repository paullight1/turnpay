import '../../features/exchange/screens/kora_exchange_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_state.dart';
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
import '../../features/home/screens/transfer_receipt_screen.dart';
import '../../features/security/screens/transaction_security_screen.dart';
import '../../features/wallet/screens/wallet_detail_screen.dart';
import '../../features/wallet/screens/receive_money_screen.dart';
import '../../features/transactions/screens/transaction_detail_screen.dart';
import '../../features/exchange/screens/manual_exchange_order_screen.dart';
import '../../features/exchange/services/manual_exchange_service.dart';
import '../../features/wallet/widgets/receiving_account_sheet.dart';
import '../config/launch_capabilities.dart';

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
  static const fund = '/home/fund';
  static const fundCheckout = '/fund/options';
  static const receivingAccountSetup = '/receive-money/details';
  static const send = '/send';
  static const sendTrustpay = '/send/trustpay';
  static const sendReceipt = '/send/receipt/:reference';
  static const sendBank = '/send/bank';
  static const withdraw = '/withdraw';
  static const withdrawAuthorize = '/withdraw/authorize/:reference';
  static const withdrawSuccess = '/withdraw/success';
  static const withdrawReceipt = '/withdraw/receipt/:reference';
  static const exchange = '/exchange';
  static const exchangeSettlement = '/exchange/settlement';
  static const exchangeOrder = '/exchange/orders/:id';
  static const airtime = '/airtime';
  static const data = '/data';
  static const cable = '/cable';
  static const electricity = '/electricity';
  static const bills = electricity;
  static const wallets = '/wallets';
  static const virtualAccount = '/home/virtual-account';
  static const activity = '/activity';
  static const vtuOrder = '/vtu/order/:reference';
  static const more = '/more';
  static const profileAccount = '/profile/account';
  static const profileAppearance = '/profile/appearance';
  static const profileSecurity = '/profile/security';
  static const transactionSecurity = '/profile/security/transaction-security';
  static const profileSupport = '/profile/support';
  static const profileReferrals = '/profile/referrals';
  static const walletDetail = '/wallet/:currency';
  static const receiveMoney = '/home/receive-money';
  static const transactionDetail = '/transaction/:reference';

  static String receiptFor(String type, String reference) {
    switch (type.toUpperCase()) {
      case 'AIRTIME':
      case 'DATA':
      case 'CABLE':
      case 'ELECTRICITY':
        return vtuOrderFor(reference);
      case 'INTERNAL_TRANSFER':
        return sendReceiptFor(reference);
      case 'WITHDRAW':
        return withdrawReceiptFor(reference);
      default:
        return transactionDetailFor(reference);
    }
  }

  static String vtuOrderFor(String reference) {
    return '/vtu/order/${Uri.encodeComponent(reference)}';
  }

  static String walletDetailFor(String currency) {
    return '/wallet/${Uri.encodeComponent(currency)}';
  }

  static String transactionDetailFor(String reference) {
    return '/transaction/${Uri.encodeComponent(reference)}';
  }

  static String exchangeOrderFor(String id) {
    return '/exchange/orders/${Uri.encodeComponent(id)}';
  }

  static String withdrawAuthorizeFor(String reference) {
    return '/withdraw/authorize/${Uri.encodeComponent(reference)}';
  }

  static String withdrawReceiptFor(String reference) {
    return '/withdraw/receipt/${Uri.encodeComponent(reference)}';
  }

  static String sendReceiptFor(String reference) =>
      '/send/receipt/${Uri.encodeComponent(reference)}';

  /// Routes that an unauthenticated / expired session is allowed to sit on.
  static const unauthenticated = <String>{
    splash,
    onboarding,
    login,
    register,
    otp,
    forgotPassword,
  };
}

/// Lets mounted tab screens pause background work while another top-level
/// route is visible, then resume when that route is popped.
final appRouteObserver = RouteObserver<ModalRoute<dynamic>>();

String? v1MoneyOutRedirectFor(String matchedLocation) {
  if (LaunchCapabilities.moneyOutEnabled) return null;
  if (matchedLocation == AppRoutes.send ||
      matchedLocation == AppRoutes.sendTrustpay ||
      matchedLocation == AppRoutes.sendBank ||
      matchedLocation == AppRoutes.withdraw ||
      matchedLocation == AppRoutes.withdrawAuthorize ||
      matchedLocation.startsWith('/withdraw/authorize/')) {
    return AppRoutes.home;
  }
  return null;
}

String? _moneyOutRedirect(BuildContext context, GoRouterState state) {
  return v1MoneyOutRedirectFor(state.matchedLocation);
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: AppRoutes.splash,
    observers: [appRouteObserver],
    debugLogDiagnostics: kDebugMode,
    // Re-run [redirect] whenever the auth signal changes so a server-rejected
    // session is pushed to the login screen even from a deep-linked route.
    refreshListenable: authStateNotifier,
    redirect: (context, state) {
      final moneyOutRedirect = v1MoneyOutRedirectFor(state.matchedLocation);
      if (moneyOutRedirect != null) return moneyOutRedirect;
      if (!authStateNotifier.sessionExpired) return null;

      // Already on a screen the user can reach while signed out — stay put.
      if (AppRoutes.unauthenticated.contains(state.matchedLocation)) {
        return null;
      }

      // Session was truly expired (server-rejected refresh) or a logged-out
      // deep link hit an authenticated route: send them to login with a flag
      // so the login screen can surface a "session expired" message.
      return Uri(
        path: AppRoutes.login,
        queryParameters: const {'expired': '1'},
      ).toString();
    },
    routes: [
      GoRoute(
        path: AppRoutes.splash,
        pageBuilder: (context, state) => _fadeTransition(
          state,
          SplashScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.home,
        pageBuilder: (context, state) => _fadeTransition(
          state,
          MainShell(),
        ),
        // A cold account deep link must have a real home page underneath the
        // dismissible sheet, just as it does when opened from the dashboard.
        routes: [
          GoRoute(
              path: 'fund',
              pageBuilder: (context, state) => AccountSheetPage(
                  key: state.pageKey,
                  child: const ReceivingAccountSheet(funding: true))),
          GoRoute(
              path: 'virtual-account',
              pageBuilder: (context, state) => AccountSheetPage(
                  key: state.pageKey, child: const ReceivingAccountSheet())),
          GoRoute(
              path: 'receive-money',
              pageBuilder: (context, state) => AccountSheetPage(
                  key: state.pageKey, child: const ReceivingAccountSheet())),
        ],
      ),
      GoRoute(
        path: AppRoutes.notifications,
        pageBuilder: (context, state) => _slideTransition(
          state,
          DashboardDetailScreen(kind: DashboardDetailKind.notifications),
        ),
      ),
      GoRoute(
        path: AppRoutes.profileAccount,
        pageBuilder: (context, state) => _slideTransition(
          state,
          ProfileActionScreen(kind: ProfileActionKind.account),
        ),
      ),
      GoRoute(
        path: AppRoutes.profileAppearance,
        pageBuilder: (context, state) => _slideTransition(
          state,
          ProfileActionScreen(kind: ProfileActionKind.appearance),
        ),
      ),
      GoRoute(
        path: AppRoutes.profileSecurity,
        pageBuilder: (context, state) => _slideTransition(
          state,
          ProfileActionScreen(kind: ProfileActionKind.security),
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
        path: AppRoutes.profileReferrals,
        pageBuilder: (context, state) => _slideTransition(
            state, ProfileActionScreen(kind: ProfileActionKind.referrals)),
      ),
      GoRoute(
        path: AppRoutes.profileSupport,
        pageBuilder: (context, state) => _slideTransition(
          state,
          ProfileActionScreen(kind: ProfileActionKind.support),
        ),
      ),
      GoRoute(
        path: AppRoutes.kyc,
        builder: (context, state) => const KycVerificationScreen(),
      ),
      GoRoute(path: '/fund', redirect: (context, state) => AppRoutes.fund),
      GoRoute(
        path: AppRoutes.fundCheckout,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const MoneyActionScreen(kind: MoneyActionKind.fund),
        ),
      ),
      GoRoute(
        path: AppRoutes.send,
        redirect: _moneyOutRedirect,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const SendMoneyEntryScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.sendTrustpay,
        redirect: _moneyOutRedirect,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const MoneyActionScreen(kind: MoneyActionKind.send),
        ),
      ),
      GoRoute(
        path: AppRoutes.sendReceipt,
        pageBuilder: (context, state) => _slideTransition(
          state,
          TransferReceiptScreen(
            reference: state.pathParameters['reference'] ?? '',
            initialReceipt: state.extra is Map<String, dynamic>
                ? state.extra as Map<String, dynamic>
                : null,
          ),
        ),
      ),
      GoRoute(
        path: AppRoutes.sendBank,
        redirect: _moneyOutRedirect,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const MoneyActionScreen(kind: MoneyActionKind.withdraw),
        ),
      ),
      GoRoute(
        path: AppRoutes.withdraw,
        redirect: _moneyOutRedirect,
        pageBuilder: (context, state) {
          final prefill = state.extra as WithdrawPrefill?;
          return _slideTransition(
            state,
            MoneyActionScreen(
              kind: MoneyActionKind.withdraw,
              withdrawPrefill: prefill,
            ),
          );
        },
      ),
      GoRoute(
        path: AppRoutes.withdrawAuthorize,
        redirect: _moneyOutRedirect,
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
          const ExchangeEntryScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.exchangeOrder,
        pageBuilder: (context, state) => _slideTransition(
          state,
          ManualExchangeOrderScreen(
            orderId: Uri.decodeComponent(state.pathParameters['id'] ?? ''),
            initialOrder: state.extra is ManualExchangeOrder
                ? state.extra as ManualExchangeOrder
                : null,
          ),
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
        path: AppRoutes.cable,
        pageBuilder: (context, state) => _slideTransition(
          state,
          const MoneyActionScreen(kind: MoneyActionKind.cable),
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
          DashboardDetailScreen(kind: DashboardDetailKind.wallets),
        ),
      ),
      GoRoute(
          path: '/virtual-account',
          redirect: (context, state) => AppRoutes.virtualAccount),
      GoRoute(
        path: AppRoutes.activity,
        pageBuilder: (context, state) => _slideTransition(
          state,
          DashboardTransactionsScreen(),
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
          LoginScreen(initialEmail: _emailFromExtra(state.extra)),
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
        redirect: (context, state) =>
            _emailFromExtra(state.extra).isEmpty ? AppRoutes.login : null,
        pageBuilder: (context, state) {
          final extra = state.extra as Map<String, dynamic>? ?? {};
          return _slideTransition(
            state,
            OtpScreen(
              email: _emailFromExtra(extra),
              purpose: extra['purpose'] as String? ?? 'verify',
            ),
          );
        },
      ),
      GoRoute(
        path: AppRoutes.forgotPassword,
        pageBuilder: (context, state) => _slideTransition(
          state,
          ForgotPasswordScreen(initialEmail: _emailFromExtra(state.extra)),
        ),
      ),
      GoRoute(
        path: AppRoutes.walletDetail,
        redirect: (context, state) =>
            !LaunchCapabilities.ghanaCedisWalletEnabled &&
                    state.pathParameters['currency']?.toUpperCase() == 'GHS'
                ? AppRoutes.wallets
                : null,
        pageBuilder: (context, state) => _slideTransition(
          state,
          WalletDetailScreen(
            currency: state.pathParameters['currency'] ?? 'NGN',
          ),
        ),
      ),
      GoRoute(
          path: '/receive-money',
          redirect: (context, state) => AppRoutes.receiveMoney),
      GoRoute(
        path: AppRoutes.receivingAccountSetup,
        pageBuilder: (context, state) => _slideTransition(
          state,
          ReceiveMoneyScreen(),
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

String _emailFromExtra(Object? extra) {
  if (extra is! Map<String, dynamic>) return '';
  final email = extra['email'];
  return email is String ? email.trim().toLowerCase() : '';
}

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
  final provider = _asString(
    latestAttempt['provider'],
    fallback: _asString(
      data['provider'],
      fallback: _asString(metadata['provider'], fallback: 'PAYSTACK'),
    ),
  ).toUpperCase();

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
    provider: provider,
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
