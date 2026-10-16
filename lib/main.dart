import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'games/rubik/screens/rubik_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  runApp(const RubikDemoApp());
}

class RubikDemoApp extends StatelessWidget {
  const RubikDemoApp({super.key});

  @override
  Widget build(BuildContext context) => const MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'Rubik 3D',
    color: Color(0xFF111111),
    home: RubikScreen(),
  );
}
