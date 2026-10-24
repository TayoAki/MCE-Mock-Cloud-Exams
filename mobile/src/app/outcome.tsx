import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { Cube } from '@/components/Cube';
import { Banner, Body, Button, Icon, Screen, Small, Title } from '@/components/ui';
import { ApiError, patch, post } from '@/lib/api';
import { newId } from '@/lib/ids';
import { useCurrentEnrollment } from '@/lib/queries';
import { colors } from '@/lib/theme';

type Choice = 'passed' | 'failed' | 'postponed';

/** Journey F: graduation is a healthy end state. "Passed" stays self-reported. */
export default function Outcome() {
  const { enrollment } = useCurrentEnrollment();
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [pause, setPause] = useState(true);
  const [newDate, setNewDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(newId);

  async function save() {
    if (!enrollment || !choice) return;
    setBusy(true);
    setError(null);
    try {
      if (choice === 'postponed') {
        await patch(`/enrollments/${enrollment.id}`, { exam_date: newDate || null });
        setDone('Exam date updated. Your path keeps going.');
      } else {
        await post('/exam-outcomes', { enrollment_id: enrollment.id, result: choice, taken_at: new Date().toISOString(), pause_reminders: pause, client_request_id: requestId });
        setDone(choice === 'passed' ? 'Congratulations! Recorded as self-reported.' : "Recorded. A focused review plan can help for next time.");
      }
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const options: { key: Choice; label: string; icon: 'trophy' | 'refresh' | 'calendar' }[] = [
    { key: 'passed', label: 'I passed', icon: 'trophy' },
    { key: 'failed', label: "I didn't pass this time", icon: 'refresh' },
    { key: 'postponed', label: 'I postponed my exam', icon: 'calendar' },
  ];

  return (
    <Screen footer={done ? <Button label="Back to my path" onPress={() => router.dismissTo('/learn')} /> : <Button label="Save" disabled={!choice || (choice === 'postponed' && !!newDate && !/^\d{4}-\d{2}-\d{2}$/.test(newDate))} loading={busy} onPress={save} />}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} className="h-11 w-11 justify-center">
        <Icon name="chevron-back" size={24} color={colors.ink} />
      </Pressable>
      <View className="items-center"><Cube size={88} mood="proud" /></View>
      <Title>How did it go?</Title>
      <Body muted>Recording your result helps us improve. It never affects your access.</Body>
      {done ? <Banner tone="success">{done}</Banner> : (
        <>
          {options.map((o) => (
            <Pressable key={o.key} accessibilityRole="radio" aria-checked={choice === o.key} onPress={() => setChoice(o.key)} className={`min-h-[56px] flex-row items-center gap-3 rounded-[18px] border-2 px-4 ${choice === o.key ? 'border-primary bg-primary-tint' : 'border-border bg-surface'}`}>
              <Icon name={o.icon} size={20} color={colors.primary} />
              <Text className="text-ink text-[15px] font-semibold">{o.label}</Text>
            </Pressable>
          ))}
          {choice === 'passed' || choice === 'failed' ? (
            <View className="flex-row items-center justify-between min-h-[44px]">
              <Text className="text-ink text-[15px] flex-1">Pause study reminders</Text>
              <Switch accessibilityLabel="Pause study reminders" value={pause} onValueChange={setPause} trackColor={{ true: colors.primary, false: colors.locked }} />
            </View>
          ) : null}
          {choice === 'postponed' ? (
            <TextInput value={newDate} onChangeText={setNewDate} placeholder="New date (YYYY-MM-DD), optional" placeholderTextColor={colors.muted} accessibilityLabel="New exam date" className="min-h-[52px] rounded-[15px] border border-border bg-surface px-4 text-[16px] text-ink" />
          ) : null}
          <Small>Results stay labelled self-reported unless verified.</Small>
        </>
      )}
      {error ? <Banner tone="error">{error}</Banner> : null}
    </Screen>
  );
}
