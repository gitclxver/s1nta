import {
  doc,
  setDoc,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";

export type S1ntaVisualLinks = {
  background_visual_01: string;
  background_visual_02: string;
  background_visual_03: string;
  background_visual_04: string;
  background_visual_05: string;
  beanie_visual: string;
  pink_visual: string;
  main_visual: string;
  group_visual: string;
  logo: string;
};

export const S1NTA_VISUAL_LINKS_TEMPLATE: S1ntaVisualLinks = {
  background_visual_01:
    "https://firebasestorage.googleapis.com/v0/b/prysm-f7606.firebasestorage.app/o/s1nta%2Fvisuals%2Fbackground%2Fbackground_visual_01.png?alt=media&token=7605e419-75a0-4af2-b8da-c34bcbbf7d1a",
  background_visual_02:
    "https://firebasestorage.googleapis.com/v0/b/prysm-f7606.firebasestorage.app/o/s1nta%2Fvisuals%2Fbackground%2Fbackground_visual_02.png?alt=media&token=91196733-5cf3-4795-94f9-918c71c8a443",
  background_visual_03:
    "https://firebasestorage.googleapis.com/v0/b/prysm-f7606.firebasestorage.app/o/s1nta%2Fvisuals%2Fbackground%2Fbackground_visual_03.png?alt=media&token=3d1bc108-1d3d-455f-92c0-378b9b8d0761",
  background_visual_04:
    "https://firebasestorage.googleapis.com/v0/b/prysm-f7606.firebasestorage.app/o/s1nta%2Fvisuals%2Fbackground%2Fbackground_visual_04.png?alt=media&token=02a31882-ae11-4b4b-be0e-6c48845c8f8a",
  background_visual_05:
    "https://firebasestorage.googleapis.com/v0/b/prysm-f7606.firebasestorage.app/o/s1nta%2Fvisuals%2Fbackground%2Fbackground_visual_05.png?alt=media&token=51d23b0f-56ea-4b40-9748-ecdd6330be07",
  beanie_visual:
    "https://firebasestorage.googleapis.com/v0/b/prysm-f7606.firebasestorage.app/o/s1nta%2Fvisuals%2Fstory%2Fbeanie_visual.png?alt=media&token=cd52caef-df5c-4a27-8430-17679b098f23",
  pink_visual:
    "https://firebasestorage.googleapis.com/v0/b/prysm-f7606.firebasestorage.app/o/s1nta%2Fvisuals%2Fstory%2Fpink_visual.png?alt=media&token=f9fe3ae2-520d-4d9f-9633-08a498577bab",
  main_visual:
    "https://firebasestorage.googleapis.com/v0/b/prysm-f7606.firebasestorage.app/o/s1nta%2Fvisuals%2Fstory%2Fmain_visual.png?alt=media&token=4a4b7f63-52b7-4749-8882-73f826b1327f",
  group_visual:
    "https://firebasestorage.googleapis.com/v0/b/prysm-f7606.firebasestorage.app/o/s1nta%2Fvisuals%2Fstory%2Fgroup_visual.png?alt=media&token=c82f6538-d7d9-422b-807d-394c817ee0be",
  logo: "/assets/logo.png",
};

export async function saveS1ntaVisualLinks(
  db: Firestore,
  links: Partial<S1ntaVisualLinks>,
) {
  await setDoc(
    doc(db, "s1ntavisuals", "default"),
    {
      ...links,
      updatedAt: serverTimestamp(),
      imageSize: "1080x1350",
    },
    { merge: true },
  );
}
