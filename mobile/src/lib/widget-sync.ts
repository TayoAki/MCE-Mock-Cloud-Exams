import { useEffect } from 'react';
import { useEngagement, useMe, useQuests } from './queries';
import { syncStreakWidget } from './widget';

/** Mirrors streak, freezes and quests into the widget whenever they change. */
export function useStreakWidgetSync() {
  const me = useMe();
  const engagement = useEngagement();
  const quests = useQuests();
  const streak = me.data?.streak.current ?? 0;
  const studiedToday = !!me.data?.streak.studied_today;
  const freezes = engagement.data?.freezes ?? 0;
  const questsDone = quests.data?.quests.filter((q) => q.done).length ?? 0;
  const questsTotal = quests.data?.quests.length ?? 3;
  const ready = !!me.data;
  useEffect(() => {
    if (ready) syncStreakWidget({ signedIn: true, streak, studiedToday, freezes, questsDone, questsTotal });
  }, [ready, streak, studiedToday, freezes, questsDone, questsTotal]);
}
