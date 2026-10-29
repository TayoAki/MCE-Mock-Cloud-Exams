import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cube } from '@/components/Cube';
import { TIER_STYLE } from '@/components/gamify';
import { Confetti, CountUp, popIn, riseIn } from '@/components/motion';
import { Button, ErrorState, Icon, LoadingState, Screen, type IconName } from '@/components/ui';
import { feedback } from '@/lib/feedback';
import { useRecap } from '@/lib/queries';
import { colors } from '@/lib/theme';
import type { Recap } from '@/lib/types';

interface Slide {
  key: string;
  bg: string;
  fg: string;
  render: () => ReactNode;
}

const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

function Big({ value, suffix, color }: { value: number; suffix?: string; color: string }) {
  return (
    <View className="items-center">
      <CountUp to={value} delay={250} className="text-ink text-[72px] leading-[80px] font-extrabold" />
      {suffix ? (
        <Text className="text-[22px] font-extrabold" style={{ color }}>
          {suffix}
        </Text>
      ) : null}
    </View>
  );
}

function Badge({ icon, color, bg }: { icon: IconName; color: string; bg: string }) {
  return (
    <Animated.View entering={popIn(100)} className="h-24 w-24 rounded-full items-center justify-center" style={{ backgroundColor: bg }}>
      <Icon name={icon} size={48} color={color} />
    </Animated.View>
  );
}

function slidesFor(r: Recap): Slide[] {
  const title = r.period.kind === 'year' ? `${r.period.label} in review` : `${r.period.label} recap`;
  const slides: Slide[] = [
    {
      key: 'intro',
      bg: colors.primary,
      fg: '#FFFFFF',
      render: () => (
        <>
          <Cube size={130} mood="cheer" motion="jump" />
          <Text className="text-white text-[34px] leading-[40px] font-extrabold text-center">{title}</Text>
          <Text className="text-white/80 text-[17px] text-center">Here’s what your practice added up to.</Text>
        </>
      ),
    },
    {
      key: 'days',
      bg: colors.streakTint,
      fg: colors.streakDark,
      render: () => (
        <>
          <Badge icon="flame" color={colors.streak} bg="#FFFFFF" />
          <Big value={r.study_days} suffix={r.study_days === 1 ? 'study day' : 'study days'} color={colors.streakDark} />
          <Text className="text-ink text-[17px] text-center">
            {r.longest_streak > 1 ? `Your longest streak was ${r.longest_streak} days in a row.` : 'Every study day counts. Next time, try two in a row.'}
          </Text>
        </>
      ),
    },
    {
      key: 'answers',
      bg: colors.mint,
      fg: colors.success,
      render: () => (
        <>
          <Badge icon="checkmark-done" color={colors.success} bg="#FFFFFF" />
          <Big value={r.answered} suffix={r.answered === 1 ? 'question answered' : 'questions answered'} color={colors.success} />
          <Text className="text-ink text-[17px] text-center">
            {r.accuracy !== null ? `${r.accuracy}% right, ` : ''}
            {r.minutes ? `in about ${r.minutes} ${r.minutes === 1 ? 'minute' : 'minutes'} of focused practice.` : 'one question at a time.'}
          </Text>
        </>
      ),
    },
    {
      key: 'xp',
      bg: colors.primaryTint,
      fg: colors.primaryDark,
      render: () => (
        <>
          <Badge icon="flash" color={colors.primary} bg="#FFFFFF" />
          <Big value={r.xp} suffix="XP earned" color={colors.primaryDark} />
          <Text className="text-ink text-[17px] text-center">
            {r.best_day ? `Your biggest day was ${day(r.best_day.date)}, with ${r.best_day.xp} XP.` : 'XP measures practice, so every session counted.'}
          </Text>
        </>
      ),
    },
  ];
  if (r.top_domain) {
    slides.push({
      key: 'domain',
      bg: colors.gemTint,
      fg: colors.gemDark,
      render: () => (
        <>
          <Badge icon="layers" color={colors.gemDark} bg="#FFFFFF" />
          <Text className="text-gem-dark text-[17px] font-bold uppercase tracking-wider">Your top topic</Text>
          <Text className="text-ink text-[32px] leading-[38px] font-extrabold text-center">{r.top_domain}</Text>
          <Text className="text-ink text-[17px] text-center">
            {r.lessons ? `${r.lessons} ${r.lessons === 1 ? 'lesson' : 'lessons'}` : 'Practice'}
            {r.stories ? `, ${r.stories} ${r.stories === 1 ? 'story' : 'stories'}` : ''}
            {r.mocks ? ` and ${r.mocks} ${r.mocks === 1 ? 'mock' : 'mocks'}` : ''} along the way.
          </Text>
        </>
      ),
    });
  }
  slides.push({
    key: 'persona',
    bg: '#24243A',
    fg: '#FFFFFF',
    render: () => (
      <>
        <Text className="text-white/70 text-[17px] font-bold uppercase tracking-wider">You’re a</Text>
        <Animated.Text entering={popIn(150)} className="text-white text-[40px] leading-[46px] font-extrabold text-center">
          {r.persona.title}
        </Animated.Text>
        <Text className="text-white/85 text-[18px] leading-[26px] text-center">{r.persona.body}</Text>
      </>
    ),
  });
  if (r.badges.length || r.league) {
    slides.push({
      key: 'wins',
      bg: colors.streakTint,
      fg: colors.streakDark,
      render: () => (
        <>
          <Badge icon="ribbon" color={colors.streakDark} bg="#FFFFFF" />
          {r.badges.length ? (
            <>
              <Text className="text-streak-dark text-[22px] font-extrabold text-center">
                {r.badges.length} new {r.badges.length === 1 ? 'badge' : 'badges'}
              </Text>
              <View className="flex-row flex-wrap justify-center gap-2">
                {r.badges.slice(0, 8).map((b, i) => (
                  <Animated.View key={b} entering={popIn(150 + i * 60)} className="rounded-full bg-white px-3 py-1.5">
                    <Text className="text-ink text-[14px] font-bold">{b}</Text>
                  </Animated.View>
                ))}
              </View>
            </>
          ) : null}
          {r.league ? (
            <Text className="text-ink text-[17px] text-center">
              Best league finish: #{r.league.best_rank} in {TIER_STYLE[r.league.tier].label}
              {r.league.promotions ? `, with ${r.league.promotions} ${r.league.promotions === 1 ? 'promotion' : 'promotions'}` : ''}.
            </Text>
          ) : null}
        </>
      ),
    });
  }
  if (r.score) {
    slides.push({
      key: 'score',
      bg: colors.primary,
      fg: '#FFFFFF',
      render: () => (
        <>
          <Text className="text-white/80 text-[17px] font-bold uppercase tracking-wider">CertPath Score</Text>
          <View className="flex-row items-center gap-4">
            <Text className="text-white/70 text-[44px] font-extrabold">{r.score!.start}</Text>
            <Icon name="arrow-forward" size={32} color="#FFFFFF" />
            <CountUp to={r.score!.end} delay={300} className="text-white text-[64px] font-extrabold" />
          </View>
          <Text className="text-white/80 text-[15px] text-center">A practice score from your own answers, not a prediction of your exam result.</Text>
        </>
      ),
    });
  }
  slides.push({
    key: 'share',
    bg: colors.background,
    fg: colors.ink,
    render: () => (
      <>
        <View className="w-full rounded-[28px] bg-primary p-6 gap-3 items-center">
          <Text className="text-white/80 text-[13px] font-bold uppercase tracking-wider">{title}</Text>
          <View className="flex-row justify-around w-full">
            {[
              { n: r.study_days, l: r.study_days === 1 ? 'study day' : 'study days' },
              { n: r.answered, l: r.answered === 1 ? 'question' : 'questions' },
              { n: r.xp, l: 'XP' },
            ].map((x) => (
              <View key={x.l} className="items-center">
                <Text className="text-white text-[30px] font-extrabold">{x.n}</Text>
                <Text className="text-white/80 text-[12px] font-bold">{x.l}</Text>
              </View>
            ))}
          </View>
          <Text className="text-white text-[18px] font-extrabold">{r.persona.title}</Text>
          <Text className="text-white/70 text-[12px]">CertPath</Text>
        </View>
        <Text className="text-ink text-[17px] text-center">Proud of this? Share it, or keep it for yourself.</Text>
      </>
    ),
  });
  return slides;
}

/** A month or year in review, told one card at a time. Tap the right side to move on, the left to go back. */
export default function RecapScreen() {
  const params = useLocalSearchParams<{ period?: string; value?: string }>();
  const period = params.period === 'year' ? 'year' : 'month';
  const recap = useRecap(period, params.value);
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [shared, setShared] = useState(false);

  if (recap.isLoading) return <Screen><LoadingState label="Gathering your recap" /></Screen>;
  if (recap.error || !recap.data) return <Screen><ErrorState error={recap.error} onRetry={() => recap.refetch()} /></Screen>;
  const r = recap.data;
  if (r.empty) {
    return (
      <Screen footer={<Button label="Start a lesson" onPress={() => router.replace('/learn')} />}>
        <View className="items-center gap-4 pt-16">
          <Cube size={120} mood="sleepy" />
          <Text accessibilityRole="header" className="text-ink text-[24px] font-extrabold text-center">
            Nothing to recap for {r.period.label} yet
          </Text>
          <Text className="text-muted text-[16px] text-center">Your first lesson starts the story.</Text>
        </View>
      </Screen>
    );
  }

  const slides = slidesFor(r);
  const slide = slides[index]!;
  const last = index === slides.length - 1;
  const go = (by: number) => {
    const next = Math.max(0, Math.min(slides.length - 1, index + by));
    if (next !== index) feedback.tick();
    setIndex(next);
  };
  const share = async () => {
    try {
      // Browsers without a share sheet get the text on the clipboard instead.
      const nav = typeof navigator === 'undefined' ? undefined : (navigator as { share?: unknown; clipboard?: { writeText: (t: string) => Promise<void> } });
      if (Platform.OS === 'web' && !nav?.share) {
        await nav?.clipboard?.writeText(r.share_text);
      } else {
        await Share.share({ message: r.share_text });
      }
      setShared(true);
    } catch {
      // Sharing was cancelled.
    }
  };

  return (
    <View className="flex-1" style={{ backgroundColor: slide.bg, paddingTop: insets.top }}>
      <View className="flex-row gap-1 px-4 pt-2" accessibilityLabel={`Card ${index + 1} of ${slides.length}`}>
        {slides.map((s, i) => (
          <View key={s.key} className="flex-1 h-1 rounded-full" style={{ backgroundColor: i <= index ? slide.fg : `${slide.fg}33` }} />
        ))}
      </View>
      <View className="flex-row justify-end px-2">
        <Pressable accessibilityRole="button" accessibilityLabel="Close the recap" onPress={() => router.back()} className="h-11 w-11 items-center justify-center">
          <Icon name="close" size={26} color={slide.fg} />
        </Pressable>
      </View>
      <View className="flex-1">
        <Animated.View key={slide.key} entering={riseIn(0)} className="flex-1 items-center justify-center gap-5 px-8">
          {slide.render()}
        </Animated.View>
        {/* Tap zones: left goes back, right goes forward. Buttons below do the same for assistive tech. */}
        {!last ? (
          <View className="absolute inset-0 flex-row" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Pressable className="flex-1" onPress={() => go(-1)} />
            <Pressable className="flex-[2]" onPress={() => go(1)} />
          </View>
        ) : null}
      </View>
      <View className="px-5 pt-3 gap-2" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        {last ? (
          <>
            <Button label={shared ? 'Shared!' : 'Share my recap'} icon="share-outline" onPress={share} />
            <Button label="Done" variant="ghost" onPress={() => router.back()} />
          </>
        ) : (
          <View className="flex-row gap-2">
            {index > 0 ? (
              <View className="flex-1">
                <Button label="Back" variant="secondary" onPress={() => go(-1)} />
              </View>
            ) : null}
            <View className="flex-[2]">
              <Button label="Next" onPress={() => go(1)} />
            </View>
          </View>
        )}
      </View>
      {slide.key === 'intro' || last ? <Confetti key={slide.key} count={last ? 50 : 70} /> : null}
    </View>
  );
}
