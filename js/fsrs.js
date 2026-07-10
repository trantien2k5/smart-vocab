/* =========================================================================
   FSRS-6 — verified against the official spec
   (open-spaced-repetition/awesome-fsrs wiki "The Algorithm", FSRS-6 section;
   same default weights as py-fsrs / ts-fsrs).
   ========================================================================= */
const FSRS = (() => {
  const w = [0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,
             0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542];
  const DECAY = -w[20];
  const FACTOR = Math.pow(0.9, -1/w[20]) - 1; // ensures R(t=S,S)=0.9
  const clamp = (v,lo,hi)=>Math.max(lo,Math.min(hi,v));

  function retrievability(elapsedDays, stability){
    if(stability<=0) return 0;
    return Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
  }
  function initStability(g){ return Math.max(w[g-1], 0.1); }
  function initDifficulty(g){
    const d = w[4] - Math.exp(w[5]*(g-1)) + 1;
    return clamp(d,1,10);
  }
  function nextDifficulty(d,g){
    const deltaD = -w[6]*(g-3);
    const dp = d + deltaD*((10-d)/9); // linear damping
    const d0four = initDifficulty(4);
    const dpp = w[7]*d0four + (1-w[7])*dp; // mean reversion
    return clamp(dpp,1,10);
  }
  function nextStabilitySuccess(d,s,r,g){
    const hardPenalty = g===2 ? w[15] : 1;
    const easyBonus = g===4 ? w[16] : 1;
    const sInc = Math.exp(w[8]) * (11-d) * Math.pow(s,-w[9]) * (Math.exp(w[10]*(1-r))-1) * hardPenalty * easyBonus;
    return s * (Math.max(sInc,0) + 1);
  }
  function nextStabilityFail(d,s,r){
    return w[11]*Math.pow(d,-w[12])*(Math.pow(s+1,w[13])-1)*Math.exp(w[14]*(1-r));
  }
  function nextStabilityShortTerm(s,g){
    // FSRS-6: S' = S * e^(w17*(G-3+w18)) * S^(-w19)
    return s * Math.exp(w[17]*(g-3+w[18])) * Math.pow(s,-w[19]);
  }
  // Interval (days) that targets the given desired retention r for a card
  // with stability S. Official formula: I(r,S) = S/FACTOR * (r^(1/DECAY) - 1)
  function intervalForRetention(stability, retention){
    retention = clamp(retention || 0.9, 0.7, 0.97);
    return stability / FACTOR * (Math.pow(retention, 1/DECAY) - 1);
  }
  // Official fuzz (from the fsrs4anki/Anki reference implementation):
  // only applied to intervals >= 2.5 days, +/-5% (with a +/-1 day buffer).
  function applyFuzz(ivlDays, enableFuzz){
    if(!enableFuzz || ivlDays < 2.5) return ivlDays;
    const ivl = Math.round(ivlDays);
    const minIvl = Math.max(2, Math.round(ivl*0.95 - 1));
    const maxIvl = Math.round(ivl*1.05 + 1);
    return minIvl + Math.floor(Math.random()*(maxIvl-minIvl+1));
  }
  // grade: 1 again, 2 hard, 3 good, 4 easy
  function schedule(card, grade, now, opts){
    now = now || Date.now();
    opts = opts || {};
    const retention = opts.retention || 0.9;
    const fuzz = opts.fuzz!==undefined ? opts.fuzz : true;
    const isNew = !card.state || card.state==='new';
    let elapsedDays = 0;
    if(card.lastReview) elapsedDays = Math.max(0,(now - card.lastReview)/86400000);
    const sameDay = card.lastReview && elapsedDays < 1;

    let difficulty, stability, r;
    if(isNew){
      difficulty = initDifficulty(grade);
      stability = initStability(grade);
      r = 1;
    } else {
      r = retrievability(elapsedDays, card.stability);
      difficulty = nextDifficulty(card.difficulty, grade);
      if(sameDay){
        stability = nextStabilityShortTerm(card.stability, grade);
      } else if(grade===1){
        stability = nextStabilityFail(card.difficulty, card.stability, r);
      } else {
        stability = nextStabilitySuccess(card.difficulty, card.stability, r, grade);
      }
    }
    stability = Math.max(stability, 0.1);

    let intervalDays;
    if(grade===1){
      // First-time failure (new card) or same-day lapse: short relearning step.
      // Only a lapse on an *already learned* card (reviewed on a previous day) waits until tomorrow.
      intervalDays = (isNew || sameDay) ? (10/1440) : 1;
    } else {
      intervalDays = clamp(Math.round(intervalForRetention(stability, retention)), 1, 36500);
      intervalDays = applyFuzz(intervalDays, fuzz);
    }
    const due = now + intervalDays*86400000;
    let newState;
    if(grade===1) newState = 'relearning';
    else if(stability < 21) newState = 'learning';
    else newState = 'review';

    return {
      difficulty, stability, retrievability:r,
      due, lastReview:now, intervalDays,
      reps:(card.reps||0)+1,
      lapses:(card.lapses||0)+(grade===1?1:0),
      state:newState
    };
  }
  function previewIntervals(card, now, opts){
    now = now || Date.now();
    const out = {};
    [1,2,3,4].forEach(g=>{
      const res = schedule(card, g, now, Object.assign({}, opts, {fuzz:false}));
      out[g] = res.intervalDays;
    });
    return out;
  }
  function formatInterval(days){
    if(days < 1) return Math.round(days*1440)+' phút';
    if(days < 30) return Math.round(days)+' ngày';
    if(days < 365) return Math.round(days/30)+' tháng';
    return Math.round(days/365*10)/10+' năm';
  }
  return {schedule, previewIntervals, formatInterval, retrievability};
})();
