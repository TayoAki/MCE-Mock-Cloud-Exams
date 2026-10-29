import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  ZoomIn,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@/lib/theme';

/**
 * Small motion building blocks. Every one honours the system Reduce Motion
 * setting: transforms and confetti are skipped and content shows in its final
 * state, so nothing depends on animation to be understood.
 */

/**
 * Spring presets. Reanimated 4's default spring is heavy (mass 4), so a config
 * that only sets damping wobbles for seconds; these all use mass 1.
 */
export const SPRING = {
  /** Settles quickly with a hint of overshoot, after a timed pop. */
  settle: { damping: 18, stiffness: 220, mass: 1 },
  /** A playful bounce for entrances. */
  bouncy: { damping: 10, stiffness: 180, mass: 1 },
  /** Tight and quick, for press feedback. */
  press: { damping: 20, stiffness: 500, mass: 1 },
} as const;

/** Entrance presets for `entering=`; Reanimated skips them under Reduce Motion. */
export const popIn = (delay = 0) => ZoomIn.delay(delay).springify().mass(1).damping(11).stiffness(220);
export const riseIn = (delay = 0) => FadeInDown.delay(delay).springify().mass(1).damping(16).stiffness(180);

/** A quick scale-up that springs back: the shared "pop". */
export const pop = (to: number) => withSequence(withTiming(to, { duration: 130, easing: Easing.out(Easing.quad) }), withSpring(1, SPRING.settle));

/** Scales its children up briefly whenever `value` increases (e.g. XP or streak). */
export function Bump({ value, children, to = 1.25 }: { value: number; children: ReactNode; to?: number }) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const previous = useRef(value);
  useEffect(() => {
    if (value > previous.current && !reduced) {
      scale.set(pop(to));
    }
    previous.current = value;
  }, [value, reduced, scale, to]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** A gentle breathing loop that draws the eye to the next thing to tap. */
export function Pulse({ active, children, to = 1.06 }: { active: boolean; children: ReactNode; to?: number }) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (!active || reduced) {
      scale.set(withTiming(1, { duration: 150 }));
      return;
    }
    const ease = Easing.inOut(Easing.quad);
    scale.set(withRepeat(withSequence(withTiming(to, { duration: 900, easing: ease }), withTiming(1, { duration: 900, easing: ease })), -1));
    return () => cancelAnimation(scale);
  }, [active, reduced, scale, to]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** Counts a number up from zero after `delay`; tap-to-skip passes `skip`. */
export function CountUp({ to, prefix = '', suffix = '', delay = 0, duration = 900, skip = false, className }: { to: number; prefix?: string; suffix?: string; delay?: number; duration?: number; skip?: boolean; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (reduced || skip) return;
    let frame = 0;
    let started = 0;
    const step = (now: number) => {
      started ||= now;
      const p = Math.min(1, (now - started) / duration);
      setShown(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    const timer = setTimeout(() => (frame = requestAnimationFrame(step)), delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [to, delay, duration, reduced, skip]);
  const value = reduced || skip ? to : shown;
  return (
    <Text className={className}>
      {prefix}
      {value}
      {suffix}
    </Text>
  );
}

const CONFETTI_COLORS = [colors.primary, colors.streak, '#3CCB8B', colors.coral, '#B7AEFF', '#FFD166'];

interface PieceSpec {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  delay: number;
  w: number;
  h: number;
  round: boolean;
  color: string;
}

const GRAVITY = 1500;
const FLIGHT_SECONDS = 2.4;

function makePieces(count: number, width: number, height: number): PieceSpec[] {
  return Array.from({ length: count }, (_, i) => {
    const round = Math.random() < 0.3;
    const w = round ? 8 : 7 + Math.random() * 6;
    return {
      x: width / 2 + (Math.random() - 0.5) * 60,
      y: height * 0.28,
      vx: (Math.random() - 0.5) * 2 * Math.min(width, 520) * 0.75,
      vy: -(520 + Math.random() * 520),
      spin: (Math.random() - 0.5) * 1440,
      delay: Math.random() * 180,
      w,
      h: round ? w : w * (1.6 + Math.random()),
      round,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
    };
  });
}

function Piece({ spec }: { spec: PieceSpec }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withDelay(spec.delay, withTiming(1, { duration: FLIGHT_SECONDS * 1000, easing: Easing.linear })));
  }, [progress, spec.delay]);
  const style = useAnimatedStyle(() => {
    const t = progress.get() * FLIGHT_SECONDS;
    const fade = progress.get() > 0.8 ? (1 - progress.get()) / 0.2 : 1;
    return {
      opacity: progress.get() === 0 ? 0 : fade,
      transform: [
        { translateX: spec.x + spec.vx * t },
        { translateY: spec.y + spec.vy * t + 0.5 * GRAVITY * t * t },
        { rotate: `${spec.spin * t}deg` },
      ],
    };
  });
  return (
    <Animated.View
      style={[{ position: 'absolute', left: 0, top: 0, width: spec.w, height: spec.h, borderRadius: spec.round ? spec.w / 2 : 2, backgroundColor: spec.color }, style]}
    />
  );
}

/** A one-shot confetti burst over the whole screen. Hidden from screen readers and skipped with Reduce Motion. */
export function Confetti({ count = 60 }: { count?: number }) {
  const reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const [pieces] = useState(() => makePieces(count, width, height));
  if (reduced) return null;
  return (
    <View aria-hidden style={[StyleSheet.absoluteFill, { pointerEvents: 'none', overflow: 'hidden' }]}>
      {pieces.map((spec, i) => (
        <Piece key={i} spec={spec} />
      ))}
    </View>
  );
}

/** Shakes sideways once when `trigger` turns true (a wrong answer, gently). */
export function useShake(trigger: boolean) {
  const reduced = useReducedMotion();
  const x = useSharedValue(0);
  const previous = useRef(trigger);
  useEffect(() => {
    if (trigger && !previous.current && !reduced) {
      const t = (to: number) => withTiming(to, { duration: 55 });
      x.set(withSequence(t(-9), t(9), t(-6), t(6), t(-3), t(0)));
    }
    previous.current = trigger;
  }, [trigger, reduced, x]);
  return useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
}
