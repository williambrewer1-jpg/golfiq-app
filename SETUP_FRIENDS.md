# BreakingPar friends: leaderboards and live side games – setup

You do this once (about 10 minutes, on the iPhone in Safari or on a computer). Friends don't set anything up; they join with your invite link.

**What gets shared:** game scores (with a handicap level), your nickname, the group name and live side-game scorecards (names, handicap indexes, hole scores). For guided games it also shares the tier you reached, whether you beat your own target, whether you used a pressure finish, and the result of each step (hit or miss, or strokes) so friends can play against your score. **What stays on your phone:** rounds, shots, Garmin data, coach notes and everything else.

> **Rules update (kudos and duels): do this once if you set up your group before.**
> Kudos (Clap, Fire and Flag on a friend's score) and, in a later update, duels use two new Firestore paths, `kudos` and `duels`. Both are in the rules below, so you only have to update the rules once.
> **What to do:** open **console.firebase.google.com → your project → Firestore Database → Rules**, replace everything with the rules below (or copy them from **BreakingPar → Settings → Friends**), and tap **Publish**. That's all.
> **Until you do:** nothing breaks. Scores, the league, ghosts and live side games work as before. Kudos (and duels, when they arrive) stay hidden, and the Leaderboard shows one line saying the group owner should republish the rules. Friends don't need to do anything.
> **What the new paths hold:** a kudos document is a score id, who gave it, which of the three reactions, a time and the score's week (at most 8 fields); a duel document is the challenge and each player's score (at most 20 fields). No round data, locations or contact details. A kudos document's id must be the score id plus the giver's id, which is what keeps it to one reaction each. Duel scores are hidden from the other player by the app until they have played; that is a courtesy, not security, since everyone in your private group is trusted.

**Weekly league and ghosts need no new setup.** They read the same `scores` documents the leaderboards already use, so there are no new Firestore paths and **the security rules below are unchanged**. If you set up your group before this update, you do not need to touch Firebase. A score document now has up to 17 fields (the rules allow 20), and the league is worked out on each phone from the week's scores. It resets every ISO week (Monday).

**Cost:** Firebase's free Spark plan. A group of friends uses a tiny fraction of its daily limits (50,000 reads and 20,000 writes per day), and the Spark plan has no billing account attached, so it can't charge you.

---

## A. Create the Firebase project

1. Go to **console.firebase.google.com** and sign in with a Google account.
2. Tap **Create a project**. Name it something like `breakingpar-friends`. Turn Google Analytics **off**, then create it.
3. **Turn on anonymous sign-in.** Go to **Build → Authentication → Get started → Sign-in method → Anonymous**, switch it on, then **Save**. BreakingPar gives each phone an anonymous ID, so nobody needs an account or a password.
4. **Create the database.** Go to **Build → Firestore Database → Create database**.
   - Choose **Production mode**.
   - Choose a location near you, e.g. `australia-southeast1` (Sydney).
5. **Paste the security rules.** In Firestore, open the **Rules** tab and replace everything with the rules below, then tap **Publish**. They're also in the app under **Settings → Friends**. The rules only let group members read or post scores, and only let each person write their own scores and nickname.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function signedIn() { return request.auth != null; }
    function member(g) { return signedIn() && exists(/databases/$(db)/documents/groups/$(g)/members/$(request.auth.uid)); }
    match /groups/{g} {
      allow get: if signedIn();
      allow create: if signedIn() && request.resource.data.owner == request.auth.uid;
      allow update, delete: if signedIn() && resource.data.owner == request.auth.uid;
      match /members/{uid} {
        allow read: if member(g);
        allow create, update: if signedIn() && uid == request.auth.uid && request.resource.data.nick is string && request.resource.data.nick.size() <= 30;
        allow delete: if signedIn() && uid == request.auth.uid;
      }
      match /scores/{id} {
        allow read: if member(g);
        allow create: if member(g) && request.resource.data.uid == request.auth.uid && request.resource.data.size() <= 20;
        allow delete: if member(g) && resource.data.uid == request.auth.uid;
      }
      match /live/{id} {
        allow read, create, update: if member(g);
        allow delete: if member(g) && resource.data.owner == request.auth.uid;
      }
      match /kudos/{id} {
        allow read: if member(g);
        allow create: if member(g) && request.resource.data.from_uid == request.auth.uid && id == request.resource.data.score_id + '_' + request.auth.uid && request.resource.data.size() <= 8;
        allow delete: if member(g) && resource.data.from_uid == request.auth.uid;
      }
      match /duels/{id} {
        allow read: if member(g);
        allow create: if member(g) && request.resource.data.from_uid == request.auth.uid && request.resource.data.size() <= 20;
        allow update: if member(g) && (resource.data.from_uid == request.auth.uid || resource.data.to_uid == request.auth.uid);
        allow delete: if member(g) && resource.data.from_uid == request.auth.uid;
      }
    }
  }
}
```

6. **Register the app and copy its config.**
   - Tap the **gear → Project settings → General**. Under **Your apps**, tap the **web icon `</>`**.
   - Register the app as `BreakingPar`. Don't tick Firebase Hosting.
   - Firebase shows a `firebaseConfig = { apiKey: "…", projectId: "…", … }` block. Copy the whole block.
   - The web `apiKey` isn't a secret. It only identifies the project, and the rules above are what protect the data.
7. **Optional but recommended: lock the key to your app's address.**
   - In **console.cloud.google.com**, open the same project and go to **APIs & Services → Credentials**.
   - Open the **Browser key**.
   - Under **Application restrictions**, choose **Websites** and add `https://williambrewer1-jpg.github.io/*`. Save.

## B. Connect BreakingPar and make a group

1. In BreakingPar, go to **Settings (gear) → Friends**.
2. Paste the config block from step A6, enter a nickname, then tap **Save**. The app should say **Firebase connected**. If it says anonymous sign-in failed, check step A3.
3. Enter a group name (e.g. "Saturday crew") and tap **Create group**.
4. Tap **Share invite link** and send it to your friends.

## C. What friends do

1. Open the invite link in Safari, then tap **Share → Add to Home Screen** and open BreakingPar from the new icon.
2. **Settings → Friends:** paste the invite link into **Got an invite from a friend?**, pick a nickname, then tap **Join group**.
   - Pasting is needed on iPhone because Safari and the home-screen app keep separate storage, so the link opened in Safari doesn't reach the app.
   - On other phones, opening the link may take them straight to the join screen.
3. They don't need Garmin. Practice games, the weekly challenge, the combine and side games all work with no rounds loaded.

## D. Using it

- **Practice → Leaderboard:** the weekly challenge is the same game for everyone in the group (it changes every Monday). Every score you record in Practice is posted with its handicap level. You'll also find the monthly combine board and all-time bests per game there.
- **Play → start a round → Playing partners & side games:**
  - Add up to three partners with their handicap indexes and tick the games: Stableford, skins, match play / Nassau, best ball.
  - With **Share live** ticked, friends with BreakingPar can open **Play → Join a friend's round**, tap their name and enter their own scores.
  - Everyone's standings update about every 20 seconds, or straight away with **Sync now**.
  - Without a signal, keep scoring; it syncs when you're back online.
- **Leave a group:** Settings → Friends → Leave. Your posted scores stay on the board.
- **Stop using Firebase:** Settings → Friends → Firebase settings → Forget, then delete the project in the Firebase console if you want the data gone.
