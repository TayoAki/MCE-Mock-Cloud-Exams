import { Platform } from 'react-native';
import type { Widget } from 'expo-widgets';
import type { StreakWidgetProps } from '@/widgets/StreakWidget';

function nextMidnight(from: Date) {
  const d = new Date(from);
  d.setHours(24, 0, 0, 0);
  return d;
}

/**
 * Keeps the iOS streak widget current. Besides today's state it schedules the
 * next midnight, when today's study stops counting: a studied streak turns
 * "at risk", and an unstudied one ends unless a freeze covers the day.
 */
export function syncStreakWidget(state: { signedIn: boolean; streak: number; studiedToday: boolean; freezes: number; questsDone: number; questsTotal: number }) {
  if (Platform.OS !== 'ios') return;
  try {
    // Loaded only on iOS, so other platforms never evaluate the widget module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const widget = (require('@/widgets/StreakWidget') as { default: Widget<StreakWidgetProps> }).default;
    const now = new Date();
    const midnight = nextMidnight(now);
    const today: StreakWidgetProps = {
      signedIn: state.signedIn,
      streak: state.streak,
      studiedToday: state.studiedToday,
      atRisk: state.streak > 0 && !state.studiedToday,
      frozen: false,
      questsDone: state.questsDone,
      questsTotal: state.questsTotal,
    };
    const covered = state.studiedToday || state.freezes > 0;
    const tomorrow: StreakWidgetProps = {
      ...today,
      streak: covered ? state.streak : 0,
      studiedToday: false,
      atRisk: covered && state.streak > 0,
      frozen: !state.studiedToday && state.freezes > 0 && state.streak > 0,
      questsDone: 0,
    };
    widget.updateTimeline([
      { date: now, props: today },
      { date: midnight, props: tomorrow },
    ]);
  } catch {
    // Widgets need a development or store build; Expo Go and older iOS simply skip this.
  }
}
