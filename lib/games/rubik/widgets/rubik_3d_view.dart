import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:webview_flutter/webview_flutter.dart';

class Rubik3DView extends StatefulWidget {
  const Rubik3DView({super.key});

  @override
  State<Rubik3DView> createState() => _Rubik3DViewState();
}

class _Rubik3DViewState extends State<Rubik3DView> with WidgetsBindingObserver {
  late final WebViewController controller;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF111111))
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (_) => _ready = false,
          onPageFinished: (_) {
            if (!mounted) return;
            _ready = true;
            _setActive(
              WidgetsBinding.instance.lifecycleState ==
                  AppLifecycleState.resumed,
            );
          },
        ),
      )
      ..loadFlutterAsset('assets/rubik/index.html');
  }

  Future<void> _setActive(bool active) async {
    if (!_ready) return;
    try {
      await controller.runJavaScript('window.setRubikActive?.($active);');
    } catch (_) {
      // The native view may already be detached during app shutdown.
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _setActive(state == AppLifecycleState.resumed);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    controller
        .runJavaScript('window.disposeRubik?.();')
        .catchError((Object _) {});
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => WebViewWidget(
    controller: controller,
    gestureRecognizers: {
      Factory<OneSequenceGestureRecognizer>(() => EagerGestureRecognizer()),
    },
  );
}
