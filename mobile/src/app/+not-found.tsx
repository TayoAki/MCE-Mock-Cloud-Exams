import { router } from 'expo-router';
import { Body, Button, Screen, Title } from '@/components/ui';

export default function NotFound() {
  return (
    <Screen>
      <Title>That page doesn’t exist.</Title>
      <Body muted>Let’s get you back to your path.</Body>
      <Button label="Go to my path" onPress={() => router.replace('/')} />
    </Screen>
  );
}
