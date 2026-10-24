import { Text, View } from 'react-native';
import { Icon } from './ui';

const LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Monday-first study days for the current local week. */
export function WeekDots({ week }: { week: { date: string; studied: boolean; is_today: boolean }[] }) {
  return (
    <View className="flex-row justify-between">
      {week.map((d, i) => (
        <View
          key={d.date}
          className="items-center gap-1.5"
          accessibilityLabel={`${d.date}${d.is_today ? ', today' : ''}: ${d.studied ? 'studied' : 'not studied'}`}
        >
          <Text className={`text-[12px] ${d.is_today ? 'text-ink font-bold' : 'text-muted'}`}>{LABELS[i]}</Text>
          <View className={`h-8 w-8 rounded-full items-center justify-center ${d.studied ? 'bg-streak' : 'bg-border'}`}>
            {d.studied ? <Icon name="flame" size={16} color="#FFFFFF" /> : <Text className="text-muted text-xs">·</Text>}
          </View>
        </View>
      ))}
    </View>
  );
}

