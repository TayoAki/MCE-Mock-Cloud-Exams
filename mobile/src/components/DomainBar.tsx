import { Text, View } from 'react-native';
import { ProgressBar } from './ui';

/** A domain row that always shows its denominator. */
export function DomainBar({ title, correct, total, hidePercent }: { title: string; correct: number; total: number; hidePercent?: boolean }) {
  return (
    <View className="gap-1.5" accessibilityLabel={`${title}: ${correct} of ${total} correct`}>
      <View className="flex-row justify-between gap-3">
        <Text className="text-ink text-[14px] flex-1" numberOfLines={1}>
          {title}
        </Text>
        <Text className="text-ink text-[14px] font-bold">
          {correct}/{total}
        </Text>
      </View>
      {hidePercent ? <Text className="text-muted text-[12px]">Not enough practice yet</Text> : <ProgressBar value={total ? correct / total : 0} />}
    </View>
  );
}
