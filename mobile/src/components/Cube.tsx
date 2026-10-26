import { useEffect, useState } from 'react';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path, Polygon } from 'react-native-svg';
import { SPRING } from './motion';

export type CubeMood = 'happy' | 'proud' | 'thinking' | 'cheer' | 'sleepy';

const INK = '#24243A';
const ARM = '#4D37CE';

/** Arm end points [left, right]; raised arms read as celebration. */
const ARMS: Record<CubeMood, [[number, number], [number, number]]> = {
  happy: [[6, 50], [94, 50]],
  proud: [[6, 50], [94, 40]],
  thinking: [[6, 50], [88, 66]],
  cheer: [[6, 36], [94, 36]],
  sleepy: [[8, 62], [92, 62]],
};

function Face({ mood, blink }: { mood: CubeMood; blink: boolean }) {
  const closed = blink || mood === 'sleepy';
  const look = mood === 'thinking' ? { dx: 1.5, dy: -1.5 } : { dx: 0, dy: 0 };
  return (
    <>
      {closed ? (
        <>
          <Path d="M33 56 Q38 59 43 56" stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none" />
          <Path d="M57 56 Q62 59 67 56" stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none" />
        </>
      ) : (
        <>
          <Circle cx={38 + look.dx} cy={56 + look.dy} r="4" fill={INK} />
          <Circle cx={62 + look.dx} cy={56 + look.dy} r="4" fill={INK} />
          <Circle cx={39.4 + look.dx} cy={54.6 + look.dy} r="1.3" fill="#FFFFFF" />
          <Circle cx={63.4 + look.dx} cy={54.6 + look.dy} r="1.3" fill="#FFFFFF" />
        </>
      )}
      {mood === 'cheer' ? (
        <>
          <Path d="M41 63 Q50 77 59 63 Z" fill={INK} />
          <Circle cx="31" cy="64" r="3.5" fill="#FF8FA3" opacity={0.55} />
          <Circle cx="69" cy="64" r="3.5" fill="#FF8FA3" opacity={0.55} />
        </>
      ) : mood === 'sleepy' ? (
        <Circle cx="50" cy="67" r="2.5" fill="none" stroke={INK} strokeWidth="2.5" />
      ) : mood === 'thinking' ? (
        <Path d="M44 68 L56 66" stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none" />
      ) : (
        <Path d={mood === 'proud' ? 'M41 64 Q50 74 59 64' : 'M42 65 Q50 71 58 65'} stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none" />
      )}
    </>
  );
}

/**
 * CertPath's original cube companion. It celebrates effort; it never stands in
 * for scenario text or feedback. `motion="jump"` makes an entrance (for
 * celebrations); `idle` bobs and blinks; `still` doesn't move. Reduce Motion
 * keeps it still.
 */
export function Cube({ size = 96, mood = 'happy', motion = 'idle' }: { size?: number; mood?: CubeMood; motion?: 'idle' | 'jump' | 'still' }) {
  const reduced = useReducedMotion();
  const animate = !reduced && motion !== 'still';
  const y = useSharedValue(0);
  const scale = useSharedValue(animate && motion === 'jump' ? 0.3 : 1);
  const tilt = useSharedValue(0);
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    if (!animate) return;
    const ease = Easing.inOut(Easing.quad);
    const bob = withRepeat(withSequence(withTiming(-size * 0.04, { duration: 1300, easing: ease }), withTiming(0, { duration: 1300, easing: ease })), -1);
    if (motion === 'jump') {
      scale.set(withSpring(1, SPRING.bouncy));
      y.set(withSequence(withTiming(-size * 0.3, { duration: 280, easing: Easing.out(Easing.quad) }), withSpring(0, SPRING.bouncy), bob));
      tilt.set(withSequence(withTiming(-10, { duration: 140 }), withTiming(10, { duration: 200 }), withSpring(0, SPRING.bouncy)));
    } else {
      y.set(bob);
    }
    return () => {
      cancelAnimation(y);
      cancelAnimation(scale);
      cancelAnimation(tilt);
    };
  }, [animate, motion, size, scale, tilt, y]);

  useEffect(() => {
    if (!animate || mood === 'sleepy') return;
    let reopen: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      setBlink(true);
      reopen = setTimeout(() => setBlink(false), 140);
    }, 3800);
    return () => {
      clearInterval(timer);
      clearTimeout(reopen);
    };
  }, [animate, mood]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.get() }, { scale: scale.get() }, { rotate: `${tilt.get()}deg` }],
  }));
  const [left, right] = ARMS[mood];

  return (
    <Animated.View aria-hidden style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
        <G>
          <Line x1="18" y1="58" x2={left[0]} y2={left[1]} stroke={ARM} strokeWidth="4" strokeLinecap="round" />
          <Line x1="82" y1="58" x2={right[0]} y2={right[1]} stroke={ARM} strokeWidth="4" strokeLinecap="round" />
          <Polygon points="50,12 86,30 50,48 14,30" fill="#B7AEFF" />
          <Polygon points="14,30 50,48 50,90 14,72" fill="#8676F4" />
          <Polygon points="86,30 50,48 50,90 86,72" fill="#6750EE" />
          <Path d="M14 30 L50 48 L86 30" stroke={ARM} strokeWidth="1.5" fill="none" opacity={0.35} />
          <Face mood={mood} blink={blink} />
        </G>
      </Svg>
    </Animated.View>
  );
}
