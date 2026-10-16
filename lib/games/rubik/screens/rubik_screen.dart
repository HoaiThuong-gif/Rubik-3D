import 'package:flutter/material.dart';

import '../widgets/rubik_3d_view.dart';

class RubikScreen extends StatelessWidget {
  const RubikScreen({super.key});

  @override
  Widget build(BuildContext context) => const ColoredBox(
    color: Color(0xFF111111),
    child: SizedBox.expand(child: Rubik3DView()),
  );
}
