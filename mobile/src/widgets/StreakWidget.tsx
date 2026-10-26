import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, lineLimit, padding } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

export interface StreakWidgetProps {
  signedIn: boolean;
  streak: number;
  studiedToday: boolean;
  /** A streak is alive but today isn't studied yet. */
  atRisk: boolean;
  /** Yesterday was missed and a streak freeze covered it. */
  frozen: boolean;
  questsDone: number;
  questsTotal: number;
}

/**
 * Home-screen and Lock Screen widget: the streak and whether it is at risk
 * today. The 'widget' directive turns this function into a layout the widget
 * extension evaluates natively, so it may only use Expo UI components and
 * must not reference anything outside its own body.
 */
const StreakWidget = (props: StreakWidgetProps, env: WidgetEnvironment) => {
  'widget';
  const dark = env.colorScheme === 'dark';
  const ink = dark ? '#F3F2FA' : '#24243A';
  const muted = dark ? '#A9A8BD' : '#6F7085';
  const bg = dark ? '#1E1D2E' : '#FFFFFF';
  const orange = dark ? '#F5A623' : '#A86500';
  const green = dark ? '#3CCB8B' : '#137B60';
  const flame = props.streak > 0 ? '#F5A623' : muted;
  const days = `${props.streak} ${props.streak === 1 ? 'day' : 'days'}`;
  const status = !props.signedIn
    ? 'Open CertPath to start'
    : props.studiedToday
      ? 'Done for today'
      : props.atRisk
        ? props.frozen
          ? 'Freeze used. Study today'
          : 'Study today to keep it'
        : 'Start a streak today';
  const statusColor = props.studiedToday ? green : props.atRisk ? orange : muted;
  const quests = `${props.questsDone}/${props.questsTotal} quests`;

  if (env.widgetFamily === 'accessoryInline') {
    return <Text>{`${days} · ${props.studiedToday ? 'done today' : 'study today'}`}</Text>;
  }
  if (env.widgetFamily === 'accessoryCircular') {
    return (
      <VStack spacing={0} modifiers={[containerBackground('#00000000', 'widget')]}>
        <Image systemName="flame.fill" size={14} />
        <Text modifiers={[font({ size: 20, weight: 'bold', design: 'rounded' })]}>{`${props.streak}`}</Text>
      </VStack>
    );
  }
  if (env.widgetFamily === 'accessoryRectangular') {
    return (
      <VStack alignment="leading" spacing={2} modifiers={[containerBackground('#00000000', 'widget')]}>
        <HStack spacing={4}>
          <Image systemName="flame.fill" size={14} />
          <Text modifiers={[font({ size: 16, weight: 'bold', design: 'rounded' })]}>{`${props.streak}-day streak`}</Text>
        </HStack>
        <Text modifiers={[font({ size: 13 }), lineLimit(1)]}>{status}</Text>
        <Text modifiers={[font({ size: 12 }), lineLimit(1)]}>{quests}</Text>
      </VStack>
    );
  }

  const streakBlock = (
    <VStack alignment="leading" spacing={4}>
      <HStack spacing={6}>
        <Image systemName="flame.fill" size={28} color={flame} />
        <Text modifiers={[font({ size: 34, weight: 'heavy', design: 'rounded' }), foregroundStyle(ink)]}>{`${props.streak}`}</Text>
      </HStack>
      <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(muted)]}>day streak</Text>
      <Spacer />
      <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(statusColor), lineLimit(2)]}>{status}</Text>
    </VStack>
  );

  if (env.widgetFamily === 'systemMedium') {
    return (
      <HStack spacing={16} modifiers={[padding({ all: 4 }), containerBackground(bg, 'widget')]}>
        {streakBlock}
        <Spacer />
        <VStack alignment="leading" spacing={6}>
          <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle('#6750EE')]}>CERTPATH</Text>
          <HStack spacing={6}>
            <Image systemName={props.questsDone >= props.questsTotal ? 'gift.fill' : 'checklist'} size={16} color={orange} />
            <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundStyle(ink)]}>{quests}</Text>
          </HStack>
          <Text modifiers={[font({ size: 13 }), foregroundStyle(muted), lineLimit(2)]}>
            {props.studiedToday ? 'Come back tomorrow to grow it.' : 'One five-minute lesson does it.'}
          </Text>
        </VStack>
      </HStack>
    );
  }

  return <VStack modifiers={[padding({ all: 2 }), containerBackground(bg, 'widget')]}>{streakBlock}</VStack>;
};

export default createWidget<StreakWidgetProps>('StreakWidget', StreakWidget, {
  signedIn: false,
  streak: 0,
  studiedToday: false,
  atRisk: false,
  frozen: false,
  questsDone: 0,
  questsTotal: 3,
});
