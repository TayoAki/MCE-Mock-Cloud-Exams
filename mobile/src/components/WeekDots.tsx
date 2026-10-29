import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors } from '@/lib/theme';
import type { WeekDay } from '@/lib/types';
import { popIn } from './motion';
import { Icon, type IconName } from './ui';

/** A missed day kept by a freeze, the weekend amulet or a repair. */
const PROTECTED: Record<NonNullable<WeekDay['protected']>, { icon: IconName; label: string }> = {
  freeze: { icon: 'snow', label: 'protected by a streak freeze' },
  amulet: { icon: 'shield-checkmark', label: 'protected by the weekend amulet' },
  repair: { icon: 'bandage', label: 'restored by a streak repair' },
};

const LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Monday-first study days for the current local week. `igniteTodayAt` lights today's flame after a delay (ms), for celebrations. */
export function WeekDots({ week, igniteTodayAt }: { week: WeekDay[]; igniteTodayAt?: number }) {
  return (
    <View className="flex-row justify-between">
      {week.map((d, i) => (
        <View
          key={d.date}
          className="items-center gap-1.5"
          accessibilityLabel={`${d.date}${d.is_today ? ', today' : ''}: ${d.studied ? 'studied' : d.protected ? PROTECTED[d.protected].label : 'not studied'}`}
        >
          <Text className={`text-[12px] ${d.is_today ? 'text-ink font-bold' : 'text-muted'}`}>{LABELS[i]}</Text>
          {d.studied && d.is_today && igniteTodayAt !== undefined ? (
            <View className="h-8 w-8 rounded-full bg-border">
              <Animated.View entering={popIn(igniteTodayAt)} style={StyleSheet.absoluteFill}>
                <View className="h-8 w-8 rounded-full items-center justify-center bg-streak">
                  <Icon name="flame" size={16} color="#FFFFFF" />
                </View>
              </Animated.View>
            </View>
          ) : !d.studied && d.protected ? (
            <View className="h-8 w-8 rounded-full items-center justify-center bg-gem-tint border-2 border-gem">
              <Icon name={PROTECTED[d.protected].icon} size={15} color={colors.gemDark} />
            </View>
          ) : (
            <View className={`h-8 w-8 rounded-full items-center justify-center ${d.studied ? 'bg-streak' : 'bg-border'}`}>
              {d.studied ? <Icon name="flame" size={16} color="#FFFFFF" /> : <Text className="text-muted text-xs">·</Text>}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

