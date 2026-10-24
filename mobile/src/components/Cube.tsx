import Svg, { Circle, G, Line, Path, Polygon } from 'react-native-svg';

/**
 * CertPath's original cube companion. It celebrates effort; it never stands in
 * for scenario text or feedback.
 */
export function Cube({ size = 96, mood = 'happy' }: { size?: number; mood?: 'happy' | 'proud' | 'thinking' }) {
  const mouth =
    mood === 'thinking' ? 'M44 68 L56 66' : mood === 'proud' ? 'M41 64 Q50 74 59 64' : 'M42 65 Q50 71 58 65';
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <G>
        <Line x1="18" y1="58" x2="6" y2="50" stroke="#4D37CE" strokeWidth="4" strokeLinecap="round" />
        <Line x1="82" y1="58" x2={mood === 'proud' ? '94' : '94'} y2={mood === 'proud' ? '40' : '50'} stroke="#4D37CE" strokeWidth="4" strokeLinecap="round" />
        <Polygon points="50,12 86,30 50,48 14,30" fill="#B7AEFF" />
        <Polygon points="14,30 50,48 50,90 14,72" fill="#8676F4" />
        <Polygon points="86,30 50,48 50,90 86,72" fill="#6750EE" />
        <Path d="M14 30 L50 48 L86 30" stroke="#4D37CE" strokeWidth="1.5" fill="none" opacity={0.35} />
        <Circle cx="38" cy="56" r="4" fill="#24243A" />
        <Circle cx="62" cy="56" r="4" fill="#24243A" />
        <Circle cx="39.4" cy="54.6" r="1.3" fill="#FFFFFF" />
        <Circle cx="63.4" cy="54.6" r="1.3" fill="#FFFFFF" />
        <Path d={mouth} stroke="#24243A" strokeWidth="3" strokeLinecap="round" fill="none" />
      </G>
    </Svg>
  );
}
