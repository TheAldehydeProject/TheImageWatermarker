import { generateFixtures } from './fixtures';

export default async function globalSetup(): Promise<void> {
  await generateFixtures();
}
