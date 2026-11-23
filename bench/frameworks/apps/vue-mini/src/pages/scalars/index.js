import { definePage, ref } from '@vue-mini/core';

definePage(() => {
  const s0 = ref(0);
  const s1 = ref(1);
  const s2 = ref(2);
  const s3 = ref(3);
  const s4 = ref(4);
  const s5 = ref(5);
  const s6 = ref(6);
  const s7 = ref(7);
  const s8 = ref(8);
  const s9 = ref(9);
  const s10 = ref(10);
  const s11 = ref(11);
  const s12 = ref(12);
  const s13 = ref(13);
  const s14 = ref(14);
  const s15 = ref(15);

  const bump = () => {
    s0.value += 1;
    s1.value += 1;
    s2.value += 1;
    s3.value += 1;
    s4.value += 1;
    s5.value += 1;
    s6.value += 1;
    s7.value += 1;
    s8.value += 1;
    s9.value += 1;
    s10.value += 1;
    s11.value += 1;
    s12.value += 1;
    s13.value += 1;
    s14.value += 1;
    s15.value += 1;
  };

  return {
    s0, s1, s2, s3, s4, s5, s6, s7,
    s8, s9, s10, s11, s12, s13, s14, s15,
    bump,
  };
});
