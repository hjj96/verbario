/*
 * fdlibm 5.3 subset used by JavaScript's Math.* (V8 src/base/ieee754.cc ports the same code).
 *
 * ====================================================
 * Copyright (C) 1993-2004 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 *
 * Changes for MAYDAY: functions renamed (jsm_*), word access through memcpy (endian-neutral, no
 * aliasing UB), file-local helpers static, no errno/matherr wrappers (JavaScript has none).
 * The arithmetic is unchanged; FP contraction is disabled so the results are bit-identical on
 * every IEEE-754 double target.
 */
#pragma STDC FP_CONTRACT OFF

#include <stdint.h>
#include <string.h>
#include <math.h> /* only exact operations: sqrt (IEEE correctly rounded), fabs, floor */

#include "jsmath.h"

/* ---- word access --------------------------------------------------------------------------- */
static inline int32_t HI(double d) {
  uint64_t u;
  memcpy(&u, &d, 8);
  return (int32_t)(uint32_t)(u >> 32);
}
static inline uint32_t LO(double d) {
  uint64_t u;
  memcpy(&u, &d, 8);
  return (uint32_t)u;
}
static inline double WORDS(uint32_t hi, uint32_t lo) {
  uint64_t u = ((uint64_t)hi << 32) | (uint64_t)lo;
  double d;
  memcpy(&d, &u, 8);
  return d;
}
static inline double SET_HI(double d, int32_t hi) { return WORDS((uint32_t)hi, LO(d)); }
static inline double SET_LO(double d, uint32_t lo) { return WORDS((uint32_t)HI(d), lo); }
/* k << 20 for negative k without signed-shift UB */
static inline int32_t SHL20(int32_t k) { return (int32_t)((uint32_t)k << 20); }

static const double one = 1.0, zero = 0.0, half = 0.5;
static const double huge = 1.0e+300, tiny = 1.0e-300;
static const double two24 = 1.67772160000000000000e+07;  /* 0x41700000, 0x00000000 */
static const double twon24 = 5.96046447753906250000e-08; /* 0x3E700000, 0x00000000 */
static const double two54 = 1.80143985094819840000e+16;  /* 0x43500000, 0x00000000 */
static const double twom54 = 5.55111512312578270212e-17; /* 0x3C900000, 0x00000000 */

/* ---- s_scalbn.c ---------------------------------------------------------------------------- */
static double fd_copysign(double x, double y) {
  return SET_HI(x, (int32_t)(((uint32_t)HI(x) & 0x7fffffffu) | ((uint32_t)HI(y) & 0x80000000u)));
}

static double fd_scalbn(double x, int n) {
  int32_t k, hx;
  uint32_t lx;
  hx = HI(x);
  lx = LO(x);
  k = (hx & 0x7ff00000) >> 20; /* extract exponent */
  if (k == 0) {                /* 0 or subnormal x */
    if ((lx | ((uint32_t)hx & 0x7fffffffu)) == 0) return x; /* +-0 */
    x *= two54;
    hx = HI(x);
    k = ((hx & 0x7ff00000) >> 20) - 54;
    if (n < -50000) return tiny * x; /* underflow */
  }
  if (k == 0x7ff) return x + x; /* NaN or Inf */
  k = k + n;
  if (k > 0x7fe) return huge * fd_copysign(huge, x); /* overflow */
  if (k > 0) {                                        /* normal result */
    return SET_HI(x, (int32_t)(((uint32_t)hx & 0x800fffffu) | ((uint32_t)k << 20)));
  }
  if (k <= -54) {
    if (n > 50000) return huge * fd_copysign(huge, x); /* overflow */
    return tiny * fd_copysign(tiny, x);                /* underflow */
  }
  k += 54; /* subnormal result */
  x = SET_HI(x, (int32_t)(((uint32_t)hx & 0x800fffffu) | ((uint32_t)k << 20)));
  return x * twom54;
}

/* ---- k_rem_pio2.c ---------------------------------------------------------------------------- */
static const int init_jk[] = {2, 3, 4, 6}; /* initial value for jk */

static const double PIo2[] = {
    1.57079625129699707031e+00, /* 0x3FF921FB, 0x40000000 */
    7.54978941586159635335e-08, /* 0x3E74442D, 0x00000000 */
    5.39030252995776476554e-15, /* 0x3CF84698, 0x80000000 */
    3.28200341580791294123e-22, /* 0x3B78CC51, 0x60000000 */
    1.27065575308067607349e-29, /* 0x39F01B83, 0x80000000 */
    1.22933308981111328932e-36, /* 0x387A2520, 0x40000000 */
    2.73370053816464559624e-44, /* 0x36E38222, 0x80000000 */
    2.16741683877804819444e-51, /* 0x3569F31D, 0x00000000 */
};

static int kernel_rem_pio2(double *x, double *y, int e0, int nx, int prec, const int32_t *ipio2) {
  int32_t jz, jx, jv, jp, jk, carry, n, iq[20], i, j, k, m, q0, ih;
  double z, fw, f[20], fq[20], q[20];

  /* initialize jk */
  jk = init_jk[prec];
  jp = jk;

  /* determine jx, jv, q0, note that 3>q0 */
  jx = nx - 1;
  jv = (e0 - 3) / 24;
  if (jv < 0) jv = 0;
  q0 = e0 - 24 * (jv + 1);

  /* set up f[0] to f[jx+jk] where f[jx+jk] = ipio2[jv+jk] */
  j = jv - jx;
  m = jx + jk;
  for (i = 0; i <= m; i++, j++) f[i] = (j < 0) ? zero : (double)ipio2[j];

  /* compute q[0], q[1], ... q[jk] */
  for (i = 0; i <= jk; i++) {
    for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
    q[i] = fw;
  }

  jz = jk;
recompute:
  /* distill q[] into iq[] reversingly */
  for (i = 0, j = jz, z = q[jz]; j > 0; i++, j--) {
    fw = (double)((int32_t)(twon24 * z));
    iq[i] = (int32_t)(z - two24 * fw);
    z = q[j - 1] + fw;
  }

  /* compute n */
  z = fd_scalbn(z, q0);           /* actual value of z */
  z -= 8.0 * floor(z * 0.125);    /* trim off integer >= 8 */
  n = (int32_t)z;
  z -= (double)n;
  ih = 0;
  if (q0 > 0) { /* need iq[jz-1] to determine n */
    i = (iq[jz - 1] >> (24 - q0));
    n += i;
    iq[jz - 1] -= i << (24 - q0);
    ih = iq[jz - 1] >> (23 - q0);
  } else if (q0 == 0) {
    ih = iq[jz - 1] >> 23;
  } else if (z >= 0.5) {
    ih = 2;
  }

  if (ih > 0) { /* q > 0.5 */
    n += 1;
    carry = 0;
    for (i = 0; i < jz; i++) { /* compute 1-q */
      j = iq[i];
      if (carry == 0) {
        if (j != 0) {
          carry = 1;
          iq[i] = 0x1000000 - j;
        }
      } else {
        iq[i] = 0xffffff - j;
      }
    }
    if (q0 > 0) { /* rare case: chance is 1 in 12 */
      switch (q0) {
        case 1:
          iq[jz - 1] &= 0x7fffff;
          break;
        case 2:
          iq[jz - 1] &= 0x3fffff;
          break;
      }
    }
    if (ih == 2) {
      z = one - z;
      if (carry != 0) z -= fd_scalbn(one, q0);
    }
  }

  /* check if recomputation is needed */
  if (z == zero) {
    j = 0;
    for (i = jz - 1; i >= jk; i--) j |= iq[i];
    if (j == 0) { /* need recomputation */
      for (k = 1; iq[jk - k] == 0; k++) {
      } /* k = no. of terms needed */

      for (i = jz + 1; i <= jz + k; i++) { /* add q[jz+1] to q[jz+k] */
        f[jx + i] = (double)ipio2[jv + i];
        for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
        q[i] = fw;
      }
      jz += k;
      goto recompute;
    }
  }

  /* chop off zero terms */
  if (z == 0.0) {
    jz -= 1;
    q0 -= 24;
    while (iq[jz] == 0) {
      jz--;
      q0 -= 24;
    }
  } else { /* break z into 24-bit if necessary */
    z = fd_scalbn(z, -q0);
    if (z >= two24) {
      fw = (double)((int32_t)(twon24 * z));
      iq[jz] = (int32_t)(z - two24 * fw);
      jz += 1;
      q0 += 24;
      iq[jz] = (int32_t)fw;
    } else {
      iq[jz] = (int32_t)z;
    }
  }

  /* convert integer "bit" chunk to floating-point value */
  fw = fd_scalbn(one, q0);
  for (i = jz; i >= 0; i--) {
    q[i] = fw * (double)iq[i];
    fw *= twon24;
  }

  /* compute PIo2[0,...,jp]*q[jz,...,0] */
  for (i = jz; i >= 0; i--) {
    for (fw = 0.0, k = 0; k <= jp && k <= jz - i; k++) fw += PIo2[k] * q[i + k];
    fq[jz - i] = fw;
  }

  /* compress fq[] into y[] */
  switch (prec) {
    case 0:
      fw = 0.0;
      for (i = jz; i >= 0; i--) fw += fq[i];
      y[0] = (ih == 0) ? fw : -fw;
      break;
    case 1:
    case 2:
      fw = 0.0;
      for (i = jz; i >= 0; i--) fw += fq[i];
      y[0] = (ih == 0) ? fw : -fw;
      fw = fq[0] - fw;
      for (i = 1; i <= jz; i++) fw += fq[i];
      y[1] = (ih == 0) ? fw : -fw;
      break;
    case 3: /* painful */
      for (i = jz; i > 0; i--) {
        fw = fq[i - 1] + fq[i];
        fq[i] += fq[i - 1] - fw;
        fq[i - 1] = fw;
      }
      for (i = jz; i > 1; i--) {
        fw = fq[i - 1] + fq[i];
        fq[i] += fq[i - 1] - fw;
        fq[i - 1] = fw;
      }
      for (fw = 0.0, i = jz; i >= 2; i--) fw += fq[i];
      if (ih == 0) {
        y[0] = fq[0];
        y[1] = fq[1];
        y[2] = fw;
      } else {
        y[0] = -fq[0];
        y[1] = -fq[1];
        y[2] = -fw;
      }
  }
  return n & 7;
}

/* ---- e_rem_pio2.c ---------------------------------------------------------------------------- */
/* Table of constants for 2/pi, 396 Hex digits (476 decimal) of 2/pi */
static const int32_t two_over_pi[] = {
    0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C, 0x439041, 0xFE5163,
    0xABDEBB, 0xC561B7, 0x246E3A, 0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129,
    0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C, 0x7026B4, 0x5F7E41, 0x3991D6, 0x398353, 0x39F49C,
    0x845F8B, 0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D, 0x367ECF,
    0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5, 0xF17B3D, 0x0739F7, 0x8A5292,
    0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3,
    0x91615E, 0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA,
    0x73A8C9, 0x60E27B, 0xC08C6B,
};

static const int32_t npio2_hw[] = {
    0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB,
    0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB,
    0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
    0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB,
};

/*
 * invpio2:  53 bits of 2/pi
 * pio2_1:   first  33 bit of pi/2
 * pio2_1t:  pi/2 - pio2_1
 * pio2_2:   second 33 bit of pi/2
 * pio2_2t:  pi/2 - (pio2_1+pio2_2)
 * pio2_3:   third  33 bit of pi/2
 * pio2_3t:  pi/2 - (pio2_1+pio2_2+pio2_3)
 */
static const double invpio2 = 6.36619772367581382433e-01, /* 0x3FE45F30, 0x6DC9C883 */
    pio2_1 = 1.57079632673412561417e+00,                   /* 0x3FF921FB, 0x54400000 */
    pio2_1t = 6.07710050650619224932e-11,                  /* 0x3DD0B461, 0x1A626331 */
    pio2_2 = 6.07710050630396597660e-11,                   /* 0x3DD0B461, 0x1A600000 */
    pio2_2t = 2.02226624879595063154e-21,                  /* 0x3BA3198A, 0x2E037073 */
    pio2_3 = 2.02226624871116645580e-21,                   /* 0x3BA3198A, 0x2E000000 */
    pio2_3t = 8.47842766036889956997e-32;                  /* 0x397B839A, 0x252049C1 */

static int32_t ieee754_rem_pio2(double x, double *y) {
  double z = 0.0, w, t, r, fn;
  double tx[3];
  int32_t e0, i, j, nx, n, ix, hx;

  hx = HI(x); /* high word of x */
  ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) { /* |x| ~<= pi/4 , no need for reduction */
    y[0] = x;
    y[1] = 0;
    return 0;
  }
  if (ix < 0x4002d97c) { /* |x| < 3pi/4, special case with n=+-1 */
    if (hx > 0) {
      z = x - pio2_1;
      if (ix != 0x3ff921fb) { /* 33+53 bit pi is good enough */
        y[0] = z - pio2_1t;
        y[1] = (z - y[0]) - pio2_1t;
      } else { /* near pi/2, use 33+33+53 bit pi */
        z -= pio2_2;
        y[0] = z - pio2_2t;
        y[1] = (z - y[0]) - pio2_2t;
      }
      return 1;
    } else { /* negative x */
      z = x + pio2_1;
      if (ix != 0x3ff921fb) { /* 33+53 bit pi is good enough */
        y[0] = z + pio2_1t;
        y[1] = (z - y[0]) + pio2_1t;
      } else { /* near pi/2, use 33+33+53 bit pi */
        z += pio2_2;
        y[0] = z + pio2_2t;
        y[1] = (z - y[0]) + pio2_2t;
      }
      return -1;
    }
  }
  if (ix <= 0x413921fb) { /* |x| ~<= 2^19*(pi/2), medium size */
    t = fabs(x);
    n = (int32_t)(t * invpio2 + half);
    fn = (double)n;
    r = t - fn * pio2_1;
    w = fn * pio2_1t; /* 1st round good to 85 bit */
    if (n < 32 && ix != npio2_hw[n - 1]) {
      y[0] = r - w; /* quick check no cancellation */
    } else {
      j = ix >> 20;
      y[0] = r - w;
      i = j - ((HI(y[0]) >> 20) & 0x7ff);
      if (i > 16) { /* 2nd iteration needed, good to 118 */
        t = r;
        w = fn * pio2_2;
        r = t - w;
        w = fn * pio2_2t - ((t - r) - w);
        y[0] = r - w;
        i = j - ((HI(y[0]) >> 20) & 0x7ff);
        if (i > 49) { /* 3rd iteration need, 151 bits acc */
          t = r;      /* will cover all possible cases */
          w = fn * pio2_3;
          r = t - w;
          w = fn * pio2_3t - ((t - r) - w);
          y[0] = r - w;
        }
      }
    }
    y[1] = (r - y[0]) - w;
    if (hx < 0) {
      y[0] = -y[0];
      y[1] = -y[1];
      return -n;
    }
    return n;
  }
  /* all other (large) arguments */
  if (ix >= 0x7ff00000) { /* x is inf or NaN */
    y[0] = y[1] = x - x;
    return 0;
  }
  /* set z = scalbn(|x|,ilogb(x)-23) */
  e0 = (ix >> 20) - 1046; /* e0 = ilogb(z)-23; */
  z = WORDS((uint32_t)(ix - SHL20(e0)), LO(x));
  for (i = 0; i < 2; i++) {
    tx[i] = (double)((int32_t)(z));
    z = (z - tx[i]) * two24;
  }
  tx[2] = z;
  nx = 3;
  while (tx[nx - 1] == zero) nx--; /* skip zero term */
  n = kernel_rem_pio2(tx, y, e0, nx, 2, two_over_pi);
  if (hx < 0) {
    y[0] = -y[0];
    y[1] = -y[1];
    return -n;
  }
  return n;
}

/* ---- k_sin.c ---------------------------------------------------------------------------------- */
static const double S1 = -1.66666666666666324348e-01, /* 0xBFC55555, 0x55555549 */
    S2 = 8.33333333332248946124e-03,                  /* 0x3F811111, 0x1110F8A6 */
    S3 = -1.98412698298579493134e-04,                 /* 0xBF2A01A0, 0x19C161D5 */
    S4 = 2.75573137070700676789e-06,                  /* 0x3EC71DE3, 0x57B1FE7D */
    S5 = -2.50507602534068634195e-08,                 /* 0xBE5AE5E6, 0x8A2B9CEB */
    S6 = 1.58969099521155010221e-10;                  /* 0x3DE5D93A, 0x5ACFD57C */

static double kernel_sin(double x, double y, int iy) {
  double z, r, v;
  int32_t ix;
  ix = HI(x) & 0x7fffffff; /* high word of x */
  if (ix < 0x3e400000) {   /* |x| < 2**-27 */
    if ((int32_t)x == 0) return x; /* generate inexact */
  }
  z = x * x;
  v = z * x;
  r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy == 0) return x + v * (S1 + z * r);
  return x - ((z * (half * y - v * r) - y) - v * S1);
}

/* ---- k_cos.c ---------------------------------------------------------------------------------- */
static const double C1 = 4.16666666666666019037e-02, /* 0x3FA55555, 0x5555554C */
    C2 = -1.38888888888741095749e-03,                /* 0xBF56C16C, 0x16C15177 */
    C3 = 2.48015872894767294178e-05,                 /* 0x3EFA01A0, 0x19CB1590 */
    C4 = -2.75573143513906633035e-07,                /* 0xBE927E4F, 0x809C52AD */
    C5 = 2.08757232129817482790e-09,                 /* 0x3E21EE9E, 0xBDB4B1C4 */
    C6 = -1.13596475577881948265e-11;                /* 0xBDA8FAE9, 0xBE8838D4 */

static double kernel_cos(double x, double y) {
  double a, hz, z, r, qx;
  int32_t ix;
  ix = HI(x) & 0x7fffffff; /* ix = |x|'s high word */
  if (ix < 0x3e400000) {   /* if x < 2**27 */
    if (((int32_t)x) == 0) return one; /* generate inexact */
  }
  z = x * x;
  r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3FD33333) { /* if |x| < 0.3 */
    return one - (0.5 * z - (z * r - x * y));
  }
  if (ix > 0x3fe90000) { /* x > 0.78125 */
    qx = 0.28125;
  } else {
    qx = WORDS((uint32_t)(ix - 0x00200000), 0); /* x/4 */
  }
  hz = 0.5 * z - qx;
  a = one - qx;
  return a - (hz - (z * r - x * y));
}

/* ---- k_tan.c (2004 revision) ------------------------------------------------------------------ */
static const double T[] = {
    3.33333333333334091986e-01,  /* 3FD55555, 55555563 */
    1.33333333333201242699e-01,  /* 3FC11111, 1110FE7A */
    5.39682539762260521377e-02,  /* 3FABA1BA, 1BB341FE */
    2.18694882948595424599e-02,  /* 3F9664F4, 8406D637 */
    8.86323982359930005737e-03,  /* 3F8226E3, E96E8493 */
    3.59207910759131235356e-03,  /* 3F6D6D22, C9560328 */
    1.45620945432529025516e-03,  /* 3F57DBC8, FEE08315 */
    5.88041240820264096874e-04,  /* 3F4344D8, F2F26501 */
    2.46463134818469906812e-04,  /* 3F3026F7, 1A8D1068 */
    7.81794442939557092300e-05,  /* 3F147E88, A03792A6 */
    7.14072491382608190305e-05,  /* 3F12B80F, 32F0A7E9 */
    -1.85586374855275456654e-05, /* BEF375CB, DB605373 */
    2.59073051863633712884e-05,  /* 3EFB2A70, 74BF7AD4 */
};
static const double pio4 = 7.85398163397448278999e-01, /* 3FE921FB, 54442D18 */
    pio4lo = 3.06161699786838301793e-17;               /* 3C81A626, 33145C07 */

static double kernel_tan(double x, double y, int iy) {
  double z, r, v, w, s;
  int32_t ix, hx;

  hx = HI(x);            /* high word of x */
  ix = hx & 0x7fffffff;  /* high word of |x| */
  if (ix < 0x3e300000) { /* x < 2**-28 */
    if ((int32_t)x == 0) { /* generate inexact */
      if ((((uint32_t)ix | LO(x)) | (uint32_t)(iy + 1)) == 0) {
        return one / fabs(x);
      } else {
        if (iy == 1) {
          return x;
        } else { /* compute -1 / (x+y) carefully */
          double a, t;
          z = w = x + y;
          z = SET_LO(z, 0);
          v = y - (z - x);
          t = a = -one / w;
          t = SET_LO(t, 0);
          s = one + t * z;
          return t + a * (s + t * v);
        }
      }
    }
  }
  if (ix >= 0x3FE59428) { /* |x| >= 0.6744 */
    if (hx < 0) {
      x = -x;
      y = -y;
    }
    z = pio4 - x;
    w = pio4lo - y;
    x = z + w;
    y = 0.0;
  }
  z = x * x;
  w = z * z;
  /*
   * Break x^5*(T[1]+x^2*T[2]+...) into
   * x^5(T[1]+x^4*T[3]+...+x^20*T[11]) +
   * x^5(x^2*(T[2]+x^4*T[4]+...+x^22*[T12]))
   */
  r = T[1] + w * (T[3] + w * (T[5] + w * (T[7] + w * (T[9] + w * T[11]))));
  v = z * (T[2] + w * (T[4] + w * (T[6] + w * (T[8] + w * (T[10] + w * T[12])))));
  s = z * x;
  r = y + z * (s * (r + v) + y);
  r += T[0] * s;
  w = x + r;
  if (ix >= 0x3FE59428) {
    v = (double)iy;
    return (double)(1 - ((hx >> 30) & 2)) * (v - 2.0 * (x - (w * w / (w + v) - r)));
  }
  if (iy == 1) return w;
  /* compute -1.0 / (x+r) accurately */
  {
    double a, t;
    z = w;
    z = SET_LO(z, 0);
    v = r - (z - x);  /* z+v = r+x */
    t = a = -1.0 / w; /* a = -1.0/w */
    t = SET_LO(t, 0);
    s = 1.0 + t * z;
    return t + a * (s + t * v);
  }
}

/* ---- s_sin.c / s_cos.c / s_tan.c ------------------------------------------------------------- */
double jsm_sin(double x) {
  double y[2], z = 0.0;
  int32_t n, ix;
  ix = HI(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernel_sin(x, z, 0);
  if (ix >= 0x7ff00000) return x - x; /* sin(Inf or NaN) is NaN */
  n = ieee754_rem_pio2(x, y);
  switch (n & 3) {
    case 0:
      return kernel_sin(y[0], y[1], 1);
    case 1:
      return kernel_cos(y[0], y[1]);
    case 2:
      return -kernel_sin(y[0], y[1], 1);
    default:
      return -kernel_cos(y[0], y[1]);
  }
}

double jsm_cos(double x) {
  double y[2], z = 0.0;
  int32_t n, ix;
  ix = HI(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernel_cos(x, z);
  if (ix >= 0x7ff00000) return x - x; /* cos(Inf or NaN) is NaN */
  n = ieee754_rem_pio2(x, y);
  switch (n & 3) {
    case 0:
      return kernel_cos(y[0], y[1]);
    case 1:
      return -kernel_sin(y[0], y[1], 1);
    case 2:
      return -kernel_cos(y[0], y[1]);
    default:
      return kernel_sin(y[0], y[1], 1);
  }
}

double jsm_tan(double x) {
  double y[2], z = 0.0;
  int32_t n, ix;
  ix = HI(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernel_tan(x, z, 1);
  if (ix >= 0x7ff00000) return x - x; /* NaN */
  n = ieee754_rem_pio2(x, y);
  return kernel_tan(y[0], y[1], 1 - ((n & 1) << 1)); /* 1 -- n even, -1 -- n odd */
}

/* ---- e_asin.c / e_acos.c ---------------------------------------------------------------------- */
static const double pio2_hi = 1.57079632679489655800e+00, /* 0x3FF921FB, 0x54442D18 */
    pio2_lo = 6.12323399573676603587e-17,                 /* 0x3C91A626, 0x33145C07 */
    pio4_hi = 7.85398163397448278999e-01,                 /* 0x3FE921FB, 0x54442D18 */
    /* coefficient for R(x^2) */
    pS0 = 1.66666666666666657415e-01,  /* 0x3FC55555, 0x55555555 */
    pS1 = -3.25565818622400915405e-01, /* 0xBFD4D612, 0x03EB6F7D */
    pS2 = 2.01212532134862925881e-01,  /* 0x3FC9C155, 0x0E884455 */
    pS3 = -4.00555345006794114027e-02, /* 0xBFA48228, 0xB5688F3B */
    pS4 = 7.91534994289814532176e-04,  /* 0x3F49EFE0, 0x7501B288 */
    pS5 = 3.47933107596021167570e-05,  /* 0x3F023DE1, 0x0DFDF709 */
    qS1 = -2.40339491173441421878e+00, /* 0xC0033A27, 0x1C8A2D4B */
    qS2 = 2.02094576023350569471e+00,  /* 0x40002AE5, 0x9C598AC8 */
    qS3 = -6.88283971605453293030e-01, /* 0xBFE6066C, 0x1B8D0159 */
    qS4 = 7.70381505559019352791e-02;  /* 0x3FB3B8C5, 0xB12E9282 */
static const double pi = 3.14159265358979311600e+00; /* 0x400921FB, 0x54442D18 */

double jsm_asin(double x) {
  double t = 0.0, w, p, q, c, r, s;
  int32_t hx, ix;
  hx = HI(x);
  ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) { /* |x|>= 1 */
    if (((uint32_t)(ix - 0x3ff00000) | LO(x)) == 0) {
      /* asin(1)=+-pi/2 with inexact */
      return x * pio2_hi + x * pio2_lo;
    }
    return (x - x) / (x - x); /* asin(|x|>1) is NaN */
  } else if (ix < 0x3fe00000) { /* |x|<0.5 */
    if (ix < 0x3e400000) {      /* if |x| < 2**-27 */
      if (huge + x > one) return x; /* return x with inexact if x!=0 */
    }
    t = x * x;
    p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
    q = one + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
    w = p / q;
    return x + x * w;
  }
  /* 1> |x|>= 0.5 */
  w = one - fabs(x);
  t = w * 0.5;
  p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
  q = one + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
  s = sqrt(t);
  if (ix >= 0x3FEF3333) { /* if |x| > 0.975 */
    w = p / q;
    t = pio2_hi - (2.0 * (s + s * w) - pio2_lo);
  } else {
    w = s;
    w = SET_LO(w, 0);
    c = (t - w * w) / (s + w);
    r = p / q;
    p = 2.0 * s * r - (pio2_lo - 2.0 * c);
    q = pio4_hi - 2.0 * w;
    t = pio4_hi - (p - q);
  }
  if (hx > 0) return t;
  return -t;
}

double jsm_acos(double x) {
  double z, p, q, r, w, s, c, df;
  int32_t hx, ix;
  hx = HI(x);
  ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) { /* |x| >= 1 */
    if (((uint32_t)(ix - 0x3ff00000) | LO(x)) == 0) { /* |x|==1 */
      if (hx > 0) return 0.0;      /* acos(1) = 0  */
      return pi + 2.0 * pio2_lo;   /* acos(-1)= pi */
    }
    return (x - x) / (x - x); /* acos(|x|>1) is NaN */
  }
  if (ix < 0x3fe00000) { /* |x| < 0.5 */
    if (ix <= 0x3c600000) return pio2_hi + pio2_lo; /* if|x|<2**-57 */
    z = x * x;
    p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
    q = one + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
    r = p / q;
    return pio2_hi - (x - (pio2_lo - x * r));
  } else if (hx < 0) { /* x < -0.5 */
    z = (one + x) * 0.5;
    p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
    q = one + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
    s = sqrt(z);
    r = p / q;
    w = r * s - pio2_lo;
    return pi - 2.0 * (s + w);
  } else { /* x > 0.5 */
    z = (one - x) * 0.5;
    s = sqrt(z);
    df = s;
    df = SET_LO(df, 0);
    c = (z - df * df) / (s + df);
    p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
    q = one + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
    r = p / q;
    w = r * s + c;
    return 2.0 * (df + w);
  }
}

/* ---- s_atan.c / e_atan2.c --------------------------------------------------------------------- */
static const double atanhi[] = {
    4.63647609000806093515e-01, /* atan(0.5)hi 0x3FDDAC67, 0x0561BB4F */
    7.85398163397448278999e-01, /* atan(1.0)hi 0x3FE921FB, 0x54442D18 */
    9.82793723247329054082e-01, /* atan(1.5)hi 0x3FEF730B, 0xD281F69B */
    1.57079632679489655800e+00, /* atan(inf)hi 0x3FF921FB, 0x54442D18 */
};
static const double atanlo[] = {
    2.26987774529616870924e-17, /* atan(0.5)lo 0x3C7A2B7F, 0x222F65E2 */
    3.06161699786838301793e-17, /* atan(1.0)lo 0x3C81A626, 0x33145C07 */
    1.39033110312309984516e-17, /* atan(1.5)lo 0x3C700788, 0x7AF0CBBD */
    6.12323399573676603587e-17, /* atan(inf)lo 0x3C91A626, 0x33145C07 */
};
static const double aT[] = {
    3.33333333333329318027e-01,  /* 0x3FD55555, 0x5555550D */
    -1.99999999998764832476e-01, /* 0xBFC99999, 0x9998EBC4 */
    1.42857142725034663711e-01,  /* 0x3FC24924, 0x920083FF */
    -1.11111104054623557880e-01, /* 0xBFBC71C6, 0xFE231671 */
    9.09088713343650656196e-02,  /* 0x3FB745CD, 0xC54C206E */
    -7.69187620504482999495e-02, /* 0xBFB3B0F2, 0xAF749A6D */
    6.66107313738753120669e-02,  /* 0x3FB10D66, 0xA0D03D51 */
    -5.83357013379057348645e-02, /* 0xBFADDE2D, 0x52DEFD9A */
    4.97687799461593236017e-02,  /* 0x3FA97B4B, 0x24760DEB */
    -3.65315727442169155270e-02, /* 0xBFA2B444, 0x2C6A6C2F */
    1.62858201153657823623e-02,  /* 0x3F90AD3A, 0xE322DA11 */
};

double jsm_atan(double x) {
  double w, s1, s2, z;
  int32_t ix, hx, id;

  hx = HI(x);
  ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) { /* if |x| >= 2^66 */
    if (ix > 0x7ff00000 || (ix == 0x7ff00000 && (LO(x) != 0))) return x + x; /* NaN */
    if (hx > 0) return atanhi[3] + atanlo[3];
    return -atanhi[3] - atanlo[3];
  }
  if (ix < 0x3fdc0000) {   /* |x| < 0.4375 */
    if (ix < 0x3e200000) { /* |x| < 2^-29 */
      if (huge + x > one) return x; /* raise inexact */
    }
    id = -1;
  } else {
    x = fabs(x);
    if (ix < 0x3ff30000) {   /* |x| < 1.1875 */
      if (ix < 0x3fe60000) { /* 7/16 <=|x|<11/16 */
        id = 0;
        x = (2.0 * x - one) / (2.0 + x);
      } else { /* 11/16<=|x|< 19/16 */
        id = 1;
        x = (x - one) / (x + one);
      }
    } else {
      if (ix < 0x40038000) { /* |x| < 2.4375 */
        id = 2;
        x = (x - 1.5) / (one + 1.5 * x);
      } else { /* 2.4375 <= |x| < 2^66 */
        id = 3;
        x = -1.0 / x;
      }
    }
  }
  /* end of argument reduction */
  z = x * x;
  w = z * z;
  /* break sum from i=0 to 10 aT[i]z**(i+1) into odd and even poly */
  s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10])))));
  s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  z = atanhi[id] - ((x * (s1 + s2) - atanlo[id]) - x);
  return (hx < 0) ? -z : z;
}

static const double pi_o_4 = 7.8539816339744827900E-01, /* 0x3FE921FB, 0x54442D18 */
    pi_o_2 = 1.5707963267948965580E+00,                 /* 0x3FF921FB, 0x54442D18 */
    pi_lo = 1.2246467991473531772E-16;                  /* 0x3CA1A626, 0x33145C07 */

double jsm_atan2(double y, double x) {
  double z;
  int32_t k, m, hx, hy, ix, iy;
  uint32_t lx, ly;

  hx = HI(x);
  ix = hx & 0x7fffffff;
  lx = LO(x);
  hy = HI(y);
  iy = hy & 0x7fffffff;
  ly = LO(y);
  if (((uint32_t)ix | ((lx | (0u - lx)) >> 31)) > 0x7ff00000u ||
      ((uint32_t)iy | ((ly | (0u - ly)) >> 31)) > 0x7ff00000u) { /* x or y is NaN */
    return x + y;
  }
  if ((((uint32_t)hx - 0x3ff00000u) | lx) == 0) return jsm_atan(y); /* x=1.0 */
  m = ((hy >> 31) & 1) | ((hx >> 30) & 2); /* 2*sign(x)+sign(y) */

  /* when y = 0 */
  if (((uint32_t)iy | ly) == 0) {
    switch (m) {
      case 0:
      case 1:
        return y; /* atan(+-0,+anything)=+-0 */
      case 2:
        return pi + tiny; /* atan(+0,-anything) = pi */
      case 3:
      default:
        return -pi - tiny; /* atan(-0,-anything) =-pi */
    }
  }
  /* when x = 0 */
  if (((uint32_t)ix | lx) == 0) return (hy < 0) ? -pi_o_2 - tiny : pi_o_2 + tiny;

  /* when x is INF */
  if (ix == 0x7ff00000) {
    if (iy == 0x7ff00000) {
      switch (m) {
        case 0:
          return pi_o_4 + tiny; /* atan(+INF,+INF) */
        case 1:
          return -pi_o_4 - tiny; /* atan(-INF,+INF) */
        case 2:
          return 3.0 * pi_o_4 + tiny; /* atan(+INF,-INF) */
        case 3:
        default:
          return -3.0 * pi_o_4 - tiny; /* atan(-INF,-INF) */
      }
    } else {
      switch (m) {
        case 0:
          return zero; /* atan(+...,+INF) */
        case 1:
          return -zero; /* atan(-...,+INF) */
        case 2:
          return pi + tiny; /* atan(+...,-INF) */
        case 3:
        default:
          return -pi - tiny; /* atan(-...,-INF) */
      }
    }
  }
  /* when y is INF */
  if (iy == 0x7ff00000) return (hy < 0) ? -pi_o_2 - tiny : pi_o_2 + tiny;

  /* compute y/x */
  k = (iy - ix) >> 20;
  if (k > 60) { /* |y/x| >  2**60 */
    z = pi_o_2 + 0.5 * pi_lo;
    m &= 1;
  } else if (hx < 0 && k < -60) {
    z = 0.0; /* 0 > |y|/x > -2**-60 */
  } else {
    z = jsm_atan(fabs(y / x)); /* safe to do y/x */
  }
  switch (m) {
    case 0:
      return z; /* atan(+,+) */
    case 1:
      return -z; /* atan(-,+) */
    case 2:
      return pi - (z - pi_lo); /* atan(+,-) */
    default:                   /* case 3 */
      return (z - pi_lo) - pi; /* atan(-,-) */
  }
}

/* ---- e_exp.c ---------------------------------------------------------------------------------- */
static const double halF[2] = {0.5, -0.5},
                    twom1000 = 9.33263618503218878990e-302,     /* 2**-1000=0x01700000,0 */
    o_threshold = 7.09782712893383973096e+02,                   /* 0x40862E42, 0xFEFA39EF */
    u_threshold = -7.45133219101941108420e+02,                  /* 0xc0874910, 0xD52D3051 */
    ln2HI[2] = {6.93147180369123816490e-01,                     /* 0x3fe62e42, 0xfee00000 */
                -6.93147180369123816490e-01},                   /* 0xbfe62e42, 0xfee00000 */
    ln2LO[2] = {1.90821492927058770002e-10,                     /* 0x3dea39ef, 0x35793c76 */
                -1.90821492927058770002e-10},                   /* 0xbdea39ef, 0x35793c76 */
    invln2 = 1.44269504088896338700e+00,                        /* 0x3ff71547, 0x652b82fe */
    P1 = 1.66666666666666019037e-01,                            /* 0x3FC55555, 0x5555553E */
    P2 = -2.77777777770155933842e-03,                           /* 0xBF66C16C, 0x16BEBD93 */
    P3 = 6.61375632143793436117e-05,                            /* 0x3F11566A, 0xAF25DE2C */
    P4 = -1.65339022054652515390e-06,                           /* 0xBEBBBD41, 0xC5D26BF1 */
    P5 = 4.13813679705723846039e-08;                            /* 0x3E663769, 0x72BEA4D0 */

double jsm_exp(double x) {
  double y, hi = 0.0, lo = 0.0, c, t;
  int32_t k = 0, xsb;
  uint32_t hx;

  hx = (uint32_t)HI(x);    /* high word of x */
  xsb = (hx >> 31) & 1;    /* sign bit of x */
  hx &= 0x7fffffff;        /* high word of |x| */

  /* filter out non-finite argument */
  if (hx >= 0x40862E42) { /* if |x|>=709.78... */
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | LO(x)) != 0) return x + x; /* NaN */
      return (xsb == 0) ? x : 0.0;                     /* exp(+-inf)={inf,0} */
    }
    if (x > o_threshold) return huge * huge;         /* overflow */
    if (x < u_threshold) return twom1000 * twom1000; /* underflow */
  }

  /* argument reduction */
  if (hx > 0x3fd62e42) {   /* if  |x| > 0.5 ln2 */
    if (hx < 0x3FF0A2B2) { /* and |x| < 1.5 ln2 */
      /* V8: "We special case exp(1) here to return the correct value of E, as the computation
       * below would get the last bit wrong." (src/base/ieee754.cc) — Node: Math.exp(1) === Math.E */
      if (x == 1.0) return 2.71828182845904509080e+00; /* 0x4005BF0A, 0x8B145769 */
      hi = x - ln2HI[xsb];
      lo = ln2LO[xsb];
      k = 1 - xsb - xsb;
    } else {
      k = (int32_t)(invln2 * x + halF[xsb]);
      t = k;
      hi = x - t * ln2HI[0]; /* t*ln2HI is exact here */
      lo = t * ln2LO[0];
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {     /* when |x|<2**-28 */
    if (huge + x > one) return one + x; /* trigger inexact */
  } else {
    k = 0;
  }

  /* x is now in primary range */
  t = x * x;
  c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k == 0) return one - ((x * c) / (c - 2.0) - x);
  y = one - ((lo - (x * c) / (2.0 - c)) - hi);
  if (k >= -1021) {
    return SET_HI(y, HI(y) + SHL20(k)); /* add k to y's exponent */
  }
  y = SET_HI(y, HI(y) + SHL20(k + 1000)); /* add k to y's exponent */
  return y * twom1000;
}

/* ---- e_log.c ---------------------------------------------------------------------------------- */
static const double ln2_hi = 6.93147180369123816490e-01, /* 3fe62e42 fee00000 */
    ln2_lo = 1.90821492927058770002e-10,                 /* 3dea39ef 35793c76 */
    Lg1 = 6.666666666666735130e-01,                      /* 3FE55555 55555593 */
    Lg2 = 3.999999999940941908e-01,                      /* 3FD99999 9997FA04 */
    Lg3 = 2.857142874366239149e-01,                      /* 3FD24924 94229359 */
    Lg4 = 2.222219843214978396e-01,                      /* 3FCC71C5 1D8E78AF */
    Lg5 = 1.818357216161805012e-01,                      /* 3FC74664 96CB03DE */
    Lg6 = 1.531383769920937332e-01,                      /* 3FC39A09 D078C69F */
    Lg7 = 1.479819860511658591e-01;                      /* 3FC2F112 DF3E5244 */

double jsm_log(double x) {
  double hfsq, f, s, z, R, w, t1, t2, dk;
  int32_t k, hx, i, j;
  uint32_t lx;

  hx = HI(x); /* high word of x */
  lx = LO(x); /* low  word of x */

  k = 0;
  if (hx < 0x00100000) { /* x < 2**-1022  */
    if ((((uint32_t)hx & 0x7fffffffu) | lx) == 0) return -two54 / zero; /* log(+-0)=-inf */
    if (hx < 0) return (x - x) / zero; /* log(-#) = NaN */
    k -= 54;
    x *= two54; /* subnormal number, scale up x */
    hx = HI(x); /* high word of x */
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  i = (hx + 0x95f64) & 0x100000;
  x = SET_HI(x, hx | (i ^ 0x3ff00000)); /* normalize x or x/2 */
  k += (i >> 20);
  f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) { /* -2**-20 <= f < 2**-20 */
    if (f == zero) {
      if (k == 0) return zero;
      dk = (double)k;
      return dk * ln2_hi + dk * ln2_lo;
    }
    R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k == 0) return f - R;
    dk = (double)k;
    return dk * ln2_hi - ((R - dk * ln2_lo) - f);
  }
  s = f / (2.0 + f);
  dk = (double)k;
  z = s * s;
  i = hx - 0x6147a;
  w = z * z;
  j = 0x6b851 - hx;
  t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  R = t2 + t1;
  if (i > 0) {
    hfsq = 0.5 * f * f;
    if (k == 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
  }
  if (k == 0) return f - s * (f - R);
  return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
}

/* ---- e_log10.c -------------------------------------------------------------------------------- */
static const double ivln10 = 4.34294481903251816668e-01, /* 0x3FDBCB7B, 0x1526E50E */
    log10_2hi = 3.01029995663611771306e-01,              /* 0x3FD34413, 0x509F6000 */
    log10_2lo = 3.69423907715893078616e-13;              /* 0x3D59FEF3, 0x11F12B36 */

double jsm_log10(double x) {
  double y, z;
  int32_t i, k, hx;
  uint32_t lx;

  hx = HI(x); /* high word of x */
  lx = LO(x); /* low word of x */

  k = 0;
  if (hx < 0x00100000) { /* x < 2**-1022  */
    if ((((uint32_t)hx & 0x7fffffffu) | lx) == 0) return -two54 / zero; /* log(+-0)=-inf */
    if (hx < 0) return (x - x) / zero; /* log(-#) = NaN */
    k -= 54;
    x *= two54; /* subnormal number, scale up x */
    hx = HI(x); /* high word of x */
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  i = (int32_t)(((uint32_t)k & 0x80000000u) >> 31);
  hx = (hx & 0x000fffff) | ((0x3ff - i) << 20);
  y = (double)(k + i);
  x = SET_HI(x, hx);
  z = y * log10_2lo + ivln10 * jsm_log(x);
  return z + y * log10_2hi;
}

/* ---- s_expm1.c -------------------------------------------------------------------------------- */
static const double Q1 = -3.33333333333331316428e-02, /* BFA11111 111110F4 */
    Q2 = 1.58730158725481460165e-03,                  /* 3F5A01A0 19FE5585 */
    Q3 = -7.93650757867487942473e-05,                 /* BF14CE19 9EAADBB7 */
    Q4 = 4.00821782732936239552e-06,                  /* 3ED0CFCA 86E65239 */
    Q5 = -2.01099218183624371326e-07;                 /* BE8AFDB7 6E09C32D */

double jsm_expm1(double x) {
  double y, hi, lo, c = 0.0, t, e, hxs, hfx, r1;
  int32_t k, xsb;
  uint32_t hx;

  hx = (uint32_t)HI(x);  /* high word of x */
  xsb = (int32_t)(hx & 0x80000000u); /* sign bit of x */
  hx &= 0x7fffffff;      /* high word of |x| */

  /* filter out huge and non-finite argument */
  if (hx >= 0x4043687A) {   /* if |x|>=56*ln2 */
    if (hx >= 0x40862E42) { /* if |x|>=709.78... */
      if (hx >= 0x7ff00000) {
        if (((hx & 0xfffff) | LO(x)) != 0) return x + x; /* NaN */
        return (xsb == 0) ? x : -1.0;                    /* exp(+-inf)={inf,-1} */
      }
      if (x > o_threshold) return huge * huge; /* overflow */
    }
    if (xsb != 0) {                     /* x < -56*ln2, return -1.0 with inexact */
      if (x + tiny < 0.0) return tiny - one; /* return -1 */
    }
  }

  /* argument reduction */
  if (hx > 0x3fd62e42) {   /* if  |x| > 0.5 ln2 */
    if (hx < 0x3FF0A2B2) { /* and |x| < 1.5 ln2 */
      if (xsb == 0) {
        hi = x - ln2_hi;
        lo = ln2_lo;
        k = 1;
      } else {
        hi = x + ln2_hi;
        lo = -ln2_lo;
        k = -1;
      }
    } else {
      k = (int32_t)(invln2 * x + ((xsb == 0) ? 0.5 : -0.5));
      t = k;
      hi = x - t * ln2_hi; /* t*ln2_hi is exact here */
      lo = t * ln2_lo;
    }
    x = hi - lo;
    c = (hi - x) - lo;
  } else if (hx < 0x3c900000) { /* when |x|<2**-54, return x */
    t = huge + x;               /* return x with inexact flags when x!=0 */
    return x - (t - (huge + x));
  } else {
    k = 0;
  }

  /* x is now in primary range */
  hfx = 0.5 * x;
  hxs = x * hfx;
  r1 = one + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))));
  t = 3.0 - r1 * hfx;
  e = hxs * ((r1 - t) / (6.0 - x * t));
  if (k == 0) return x - (x * e - hxs); /* c is 0 */
  e = (x * (e - c) - c);
  e -= hxs;
  if (k == -1) return 0.5 * (x - e) - 0.5;
  if (k == 1) {
    if (x < -0.25) return -2.0 * (e - (x + 0.5));
    return one + 2.0 * (x - e);
  }
  if (k <= -2 || k > 56) { /* suffice to return exp(x)-1 */
    y = one - (e - x);
    y = SET_HI(y, HI(y) + SHL20(k)); /* add k to y's exponent */
    return y - one;
  }
  t = one;
  if (k < 20) {
    t = SET_HI(t, 0x3ff00000 - (0x200000 >> k)); /* t=1-2^-k */
    y = t - (e - x);
    y = SET_HI(y, HI(y) + SHL20(k)); /* add k to y's exponent */
  } else {
    t = SET_HI(t, ((0x3ff - k) << 20)); /* 2^-k */
    y = x - (e + t);
    y += one;
    y = SET_HI(y, HI(y) + SHL20(k)); /* add k to y's exponent */
  }
  return y;
}

/* ---- s_log1p.c -------------------------------------------------------------------------------- */
static const double Lp1 = 6.666666666666735130e-01, /* 3FE55555 55555593 */
    Lp2 = 3.999999999940941908e-01,                 /* 3FD99999 9997FA04 */
    Lp3 = 2.857142874366239149e-01,                 /* 3FD24924 94229359 */
    Lp4 = 2.222219843214978396e-01,                 /* 3FCC71C5 1D8E78AF */
    Lp5 = 1.818357216161805012e-01,                 /* 3FC74664 96CB03DE */
    Lp6 = 1.531383769920937332e-01,                 /* 3FC39A09 D078C69F */
    Lp7 = 1.479819860511658591e-01;                 /* 3FC2F112 DF3E5244 */

double jsm_log1p(double x) {
  double hfsq, f = 0.0, c = 0.0, s, z, R, u;
  int32_t k, hx, hu = 0, ax;

  hx = HI(x); /* high word of x */
  ax = hx & 0x7fffffff;

  k = 1;
  if (hx < 0x3FDA827A) {     /* x < 0.41422  */
    if (ax >= 0x3ff00000) {  /* x <= -1.0 */
      if (x == -1.0) return -two54 / zero; /* log1p(-1)=+inf */
      return (x - x) / (x - x);            /* log1p(x<-1)=NaN */
    }
    if (ax < 0x3e200000) { /* |x| < 2**-29 */
      if (two54 + x > zero /* raise inexact */
          && ax < 0x3c900000) { /* |x| < 2**-54 */
        return x;
      }
      return x - x * x * 0.5;
    }
    if (hx > 0 || hx <= ((int32_t)0xbfd2bec3)) {
      k = 0;
      f = x;
      hu = 1;
    } /* -0.2929<x<0.41422 */
  }
  if (hx >= 0x7ff00000) return x + x;
  if (k != 0) {
    if (hx < 0x43400000) {
      u = 1.0 + x;
      hu = HI(u); /* high word of u */
      k = (hu >> 20) - 1023;
      c = (k > 0) ? 1.0 - (u - x) : x - (u - 1.0); /* correction term */
      c /= u;
    } else {
      u = x;
      hu = HI(u); /* high word of u */
      k = (hu >> 20) - 1023;
      c = 0;
    }
    hu &= 0x000fffff;
    if (hu < 0x6a09e) {
      u = SET_HI(u, hu | 0x3ff00000); /* normalize u */
    } else {
      k += 1;
      u = SET_HI(u, hu | 0x3fe00000); /* normalize u/2 */
      hu = (0x00100000 - hu) >> 2;
    }
    f = u - 1.0;
  }
  hfsq = 0.5 * f * f;
  if (hu == 0) { /* |f| < 2**-20 */
    if (f == zero) {
      if (k == 0) return zero;
      c += k * ln2_lo;
      return k * ln2_hi + c;
    }
    R = hfsq * (1.0 - 0.66666666666666666 * f);
    if (k == 0) return f - R;
    return k * ln2_hi - ((R - (k * ln2_lo + c)) - f);
  }
  s = f / (2.0 + f);
  z = s * s;
  R = z * (Lp1 + z * (Lp2 + z * (Lp3 + z * (Lp4 + z * (Lp5 + z * (Lp6 + z * Lp7))))));
  if (k == 0) return f - (hfsq - s * (hfsq + R));
  return k * ln2_hi - ((hfsq - (s * (hfsq + R) + (k * ln2_lo + c))) - f);
}

/* ---- e_sinh.c / s_tanh.c ---------------------------------------------------------------------- */
static const double shuge = 1.0e307;

double jsm_sinh(double x) {
  double t, w, h;
  int32_t ix, jx;
  uint32_t lx;

  /* High word of |x|. */
  jx = HI(x);
  ix = jx & 0x7fffffff;

  /* x is INF or NaN */
  if (ix >= 0x7ff00000) return x + x;

  h = 0.5;
  if (jx < 0) h = -h;
  /* |x| in [0,22], return sign(x)*0.5*(E+E/(E+1))) */
  if (ix < 0x40360000) {   /* |x|<22 */
    if (ix < 0x3e300000) { /* |x|<2**-28 */
      if (shuge + x > one) return x; /* sinh(tiny) = tiny with inexact */
    }
    t = jsm_expm1(fabs(x));
    if (ix < 0x3ff00000) return h * (2.0 * t - t * t / (t + one));
    return h * (t + t / (t + one));
  }

  /* |x| in [22, log(maxdouble)] return 0.5*exp(|x|) */
  if (ix < 0x40862E42) return h * jsm_exp(fabs(x));

  /* |x| in [log(maxdouble), overflowthresold] */
  lx = LO(x);
  if (ix < 0x408633CE || ((ix == 0x408633ce) && (lx <= (uint32_t)0x8fb9f87d))) {
    w = jsm_exp(0.5 * fabs(x));
    t = h * w;
    return t * w;
  }

  /* |x| > overflowthresold, sinh(x) overflow */
  return x * shuge;
}

double jsm_tanh(double x) {
  double t, z;
  int32_t jx, ix;

  /* High word of |x|. */
  jx = HI(x);
  ix = jx & 0x7fffffff;

  /* x is INF or NaN */
  if (ix >= 0x7ff00000) {
    if (jx >= 0) return one / x + one; /* tanh(+-inf)=+-1 */
    return one / x - one;              /* tanh(NaN) = NaN */
  }

  /* |x| < 22 */
  if (ix < 0x40360000) {   /* |x|<22 */
    if (ix < 0x3c800000) { /* |x|<2**-55 */
      return x * (one + x); /* tanh(small) = small */
    }
    if (ix >= 0x3ff00000) { /* |x|>=1  */
      t = jsm_expm1(2.0 * fabs(x));
      z = one - 2.0 / (t + 2.0);
    } else {
      t = jsm_expm1(-2.0 * fabs(x));
      z = -t / (t + 2.0);
    }
    /* |x| > 22, return +-1 */
  } else {
    z = one - tiny; /* raised inexact flag */
  }
  return (jx >= 0) ? z : -z;
}
