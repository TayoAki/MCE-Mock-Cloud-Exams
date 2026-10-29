import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { colors } from '@/lib/theme';
import { CountUp } from './motion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** The CertPath Score as a ring that fills on arrival. */
export function ScoreRing({ score, max = 100, size = 120, stroke = 12, delay = 150 }: { score: number; max?: number; size?: number; stroke?: number; delay?: number }) {
  const reduced = useReducedMotion();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const progress = useSharedValue(reduced ? score / max : 0);
  useEffect(() => {
    progress.set(reduced ? score / max : withDelay(delay, withTiming(score / max, { duration: 900, easing: Easing.out(Easing.cubic) })));
  }, [score, max, reduced, delay, progress]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - progress.get()) }));
  return (
    <View accessible accessibilityLabel={`CertPath Score ${score} out of ${max}`} style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.primaryTint} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.primary}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
        />
      </Svg>
      <CountUp to={score} delay={delay} className={`text-ink font-extrabold ${size >= 110 ? 'text-[34px]' : 'text-[22px]'}`} />
      {size >= 110 ? <Text className="text-muted text-[11px] font-bold -mt-0.5">of {max}</Text> : null}
    </View>
  );
}

/** A small trend line for the score's recent history. */
export function Sparkline({ points, width = 260, height = 56 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <View style={{ height }} className="justify-center"><Text className="text-muted text-[12px]">Your trend appears after a few days of practice.</Text></View>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1, max - min);
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => `${(i * step).toFixed(1)},${(height - 6 - ((p - min) / span) * (height - 12)).toFixed(1)}`).join(' ');
  return (
    <View aria-hidden>
      <Svg width={width} height={height}>
        <Polyline points={coords} stroke={colors.primary} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" fill="none" />
      </Svg>
    </View>
  );
}

export function DeltaPill({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  const up = delta > 0;
  const flat = delta === 0;
  return (
    <View accessibilityLabel={`${flat ? 'No change' : `${up ? 'Up' : 'Down'} ${Math.abs(delta)}`} this week`} className={`rounded-full px-2 py-0.5 ${flat ? 'bg-border' : up ? 'bg-mint' : 'bg-coral-tint'}`}>
      <Text className={`text-[12px] font-extrabold ${flat ? 'text-muted' : up ? 'text-success' : 'text-coral-dark'}`}>
        {flat ? '±0' : `${up ? '+' : '−'}${Math.abs(delta)}`} this week
      </Text>
    </View>
  );
}
