/*
 * Math.hypot and Math.pow with V8 (Node 22) semantics.
 *
 * hypot: V8's builtin (src/builtins/math.tq, MathHypot) — NaN/Infinity screening, then the
 * absolute values are normalised by the largest one and summed with Kahan compensation in argument
 * order; result = sqrt(sum) * max. Re-implemented from that description; reproduced Node 22
 * bit for bit on 400k random 2- and 3-argument cases (PLAN §5.2).
 *
 * pow: V8's base::ieee754::pow (src/base/ieee754.cc, V8 12.4 = Node 22). It is fdlibm 5.3 e_pow.c
 * with ONE change in the final 2**z polynomial step:
 *     fdlibm: r = (z*t1)/(t1-two) - (w+z*w);
 *     V8:     r = (z*t1) / ((t1-two) - (w+z*w));
 * That single line is why Node's Math.pow differed from fdlibm on ~4-5 % of inputs. With it the port
 * matches Node 22 bit for bit: 0/4096 exporter vectors (math/jsmath_pow.f64, specials included) and
 * 0/200000 random cases (half with y = 0.375, the ocean cellSize exponent). jsm_pow_is_exact() = 1.
 */
#pragma STDC FP_CONTRACT OFF

#include <math.h>
#include <string.h>
#include <stdint.h>

#include "jsmath.h"

static double hypot_core(const double *values, int count) {
  double max = 0.0;
  int one_is_nan = 0;
  int i;
  if (count <= 0) return 0.0;
  for (i = 0; i < count; i++) {
    double v = values[i];
    if (v != v) {
      one_is_nan = 1;
    } else {
      double a = fabs(v);
      if (a > max) max = a;
    }
  }
  if (max == INFINITY) return INFINITY;
  if (one_is_nan) return NAN;
  if (max == 0.0) return 0.0;
  {
    double sum = 0.0, compensation = 0.0;
    for (i = 0; i < count; i++) {
      double n = fabs(values[i]) / max;
      double summand = n * n - compensation;
      double preliminary = sum + summand;
      compensation = (preliminary - sum) - summand;
      sum = preliminary;
    }
    return sqrt(sum) * max;
  }
}

double jsm_hypot2(double a, double b) {
  double v[2];
  v[0] = a;
  v[1] = b;
  return hypot_core(v, 2);
}

double jsm_hypot3(double a, double b, double c) {
  double v[3];
  v[0] = a;
  v[1] = b;
  v[2] = c;
  return hypot_core(v, 3);
}

double jsm_hypotn(const double *values, int count) { return hypot_core(values, count); }

/* ---- e_pow.c (fdlibm 5.3) --------------------------------------------------------------------
 * ====================================================
 * Copyright (C) 2004 by Sun Microsystems, Inc. All rights reserved.
 *
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 * fdlibm 5.3 already has the ECMAScript special values (x**±0 = 1, NaN exponent → NaN,
 * (±1)**±Infinity → NaN). The only arithmetic change is V8's grouping of the r = ... line near the
 * end (marked "V8:"), see the file header.
 */
static inline int32_t HI(double d) { uint64_t u; memcpy(&u, &d, 8); return (int32_t)(uint32_t)(u >> 32); }
static inline uint32_t LO(double d) { uint64_t u; memcpy(&u, &d, 8); return (uint32_t)u; }
static inline double WORDS(uint32_t hi, uint32_t lo) { uint64_t u = ((uint64_t)hi << 32) | lo; double d; memcpy(&d, &u, 8); return d; }
static inline double SET_HI(double d, int32_t hi) { return WORDS((uint32_t)hi, LO(d)); }
static inline double SET_LO(double d, uint32_t lo) { return WORDS((uint32_t)HI(d), lo); }

static const double
bp[] = {1.0, 1.5,},
dp_h[] = { 0.0, 5.84962487220764160156e-01,}, /* 0x3FE2B803, 0x40000000 */
dp_l[] = { 0.0, 1.35003920212974897128e-08,}, /* 0x3E4CFDEB, 0x43CFD006 */
zero    =  0.0, one  =  1.0, two  =  2.0,
two53  =  9007199254740992.0,  /* 0x43400000, 0x00000000 */
huge  =  1.0e300, tiny    =  1.0e-300,
L1  =  5.99999999999994648725e-01, /* 0x3FE33333, 0x33333303 */
L2  =  4.28571428578550184252e-01, /* 0x3FDB6DB6, 0xDB6FABFF */
L3  =  3.33333329818377432918e-01, /* 0x3FD55555, 0x518F264D */
L4  =  2.72728123808534006489e-01, /* 0x3FD17460, 0xA91D4101 */
L5  =  2.30660745775561754067e-01, /* 0x3FCD864A, 0x93C9DB65 */
L6  =  2.06975017800338417784e-01, /* 0x3FCA7E28, 0x4A454EEF */
P1   =  1.66666666666666019037e-01, /* 0x3FC55555, 0x5555553E */
P2   = -2.77777777770155933842e-03, /* 0xBF66C16C, 0x16BEBD93 */
P3   =  6.61375632143793436117e-05, /* 0x3F11566A, 0xAF25DE2C */
P4   = -1.65339022054652515390e-06, /* 0xBEBBBD41, 0xC5D26BF1 */
P5   =  4.13813679705723846039e-08, /* 0x3E663769, 0x72BEA4D0 */
lg2  =  6.93147180559945286227e-01, /* 0x3FE62E42, 0xFEFA39EF */
lg2_h  =  6.93147182464599609375e-01, /* 0x3FE62E43, 0x00000000 */
lg2_l  = -1.90465429995776804525e-09, /* 0xBE205C61, 0x0CA86C39 */
ovt =  8.0085662595372944372e-17, /* -(1024-log2(ovfl+.5ulp)) */
cp    =  9.61796693925975554329e-01, /* 0x3FEEC709, 0xDC3A03FD =2/(3ln2) */
cp_h  =  9.61796700954437255859e-01, /* 0x3FEEC709, 0xE0000000 =(float)cp */
cp_l  = -7.02846165095275826516e-09, /* 0xBE3E2FE0, 0x145B01F5 =tail of cp_h*/
ivln2    =  1.44269504088896338700e+00, /* 0x3FF71547, 0x652B82FE =1/ln2 */
ivln2_h  =  1.44269502162933349609e+00, /* 0x3FF71547, 0x60000000 =24b 1/ln2*/
ivln2_l  =  1.92596299112661746887e-08; /* 0x3E54AE0B, 0xF85DDF44 =1/ln2 tail*/

static double fdlibm_pow(double x, double y)
{
  double z,ax,z_h,z_l,p_h,p_l;
  double y1,t1,t2,r,s,t,u,v,w;
  int32_t i,j,k,yisint,n;
  int32_t hx,hy,ix,iy;
  uint32_t lx,ly;

  hx = HI(x); lx = LO(x);
  hy = HI(y); ly = LO(y);
  ix = hx&0x7fffffff;  iy = hy&0x7fffffff;
  if(((uint32_t)iy|ly)==0) return one;
  if(ix > 0x7ff00000 || ((ix==0x7ff00000)&&(lx!=0)) ||
     iy > 0x7ff00000 || ((iy==0x7ff00000)&&(ly!=0))) return x+y;
  yisint  = 0;
  if(hx<0) {
      if(iy>=0x43400000) yisint = 2;
      else if(iy>=0x3ff00000) {
    k = (iy>>20)-0x3ff;
    if(k>20) {
        uint32_t jj = ly>>(52-k);
        if((jj<<(52-k))==ly) yisint = 2-(int32_t)(jj&1);
    } else if(ly==0) {
        j = iy>>(20-k);
        if((j<<(20-k))==iy) yisint = 2-(j&1);
    }
      }
  }
  if(ly==0) {
      if (iy==0x7ff00000) {
          if((((uint32_t)ix-0x3ff00000u)|lx)==0) return  y - y;
          else if (ix >= 0x3ff00000) return (hy>=0)? y: zero;
          else return (hy<0)?-y: zero;
      }
      if(iy==0x3ff00000) { if(hy<0) return one/x; else return x; }
      if(hy==0x40000000) return x*x;
      if(hy==0x3fe00000) { if(hx>=0) return sqrt(x); }
  }
  ax   = fabs(x);
  if(lx==0) {
      if(ix==0x7ff00000||ix==0||ix==0x3ff00000){
    z = ax;
    if(hy<0) z = one/z;
    if(hx<0) {
        if(((ix-0x3ff00000)|yisint)==0) { z = (z-z)/(z-z); }
        else if(yisint==1) z = -z;
    }
    return z;
      }
  }
  n = (hx>>31)+1;
  if((n|yisint)==0) return (x-x)/(x-x);
  s = one;
  if((n|(yisint-1))==0) s = -one;
  if(iy>0x41e00000) {
      if(iy>0x43f00000){
    if(ix<=0x3fefffff) return (hy<0)? huge*huge:tiny*tiny;
    if(ix>=0x3ff00000) return (hy>0)? huge*huge:tiny*tiny;
      }
      if(ix<0x3fefffff) return (hy<0)? s*huge*huge:s*tiny*tiny;
      if(ix>0x3ff00000) return (hy>0)? s*huge*huge:s*tiny*tiny;
      t = ax-one;
      w = (t*t)*(0.5-t*(0.3333333333333333333333-t*0.25));
      u = ivln2_h*t;
      v = t*ivln2_l-w*ivln2;
      t1 = u+v;
      t1 = SET_LO(t1,0);
      t2 = v-(t1-u);
  } else {
      double ss,s2,s_h,s_l,t_h,t_l;
      n = 0;
      if(ix<0x00100000) {ax *= two53; n -= 53; ix = HI(ax); }
      n  += ((ix)>>20)-0x3ff;
      j  = ix&0x000fffff;
      ix = j|0x3ff00000;
      if(j<=0x3988E) k=0;
      else if(j<0xBB67A) k=1;
      else {k=0;n+=1;ix -= 0x00100000;}
      ax = SET_HI(ax, ix);
      u = ax-bp[k];
      v = one/(ax+bp[k]);
      ss = u*v;
      s_h = ss;
      s_h = SET_LO(s_h,0);
      t_h = zero;
      t_h = SET_HI(t_h, ((ix>>1)|0x20000000)+0x00080000+(k<<18));
      t_l = ax - (t_h-bp[k]);
      s_l = v*((u-s_h*t_h)-s_h*t_l);
      s2 = ss*ss;
      r = s2*s2*(L1+s2*(L2+s2*(L3+s2*(L4+s2*(L5+s2*L6)))));
      r += s_l*(s_h+ss);
      s2  = s_h*s_h;
      t_h = 3.0+s2+r;
      t_h = SET_LO(t_h,0);
      t_l = r-((t_h-3.0)-s2);
      u = s_h*t_h;
      v = s_l*t_h+t_l*ss;
      p_h = u+v;
      p_h = SET_LO(p_h,0);
      p_l = v-(p_h-u);
      z_h = cp_h*p_h;
      z_l = cp_l*p_h+p_l*cp+dp_l[k];
      t = (double)n;
      t1 = (((z_h+z_l)+dp_h[k])+t);
      t1 = SET_LO(t1,0);
      t2 = z_l-(((t1-t)-dp_h[k])-z_h);
  }
  y1  = y;
  y1 = SET_LO(y1,0);
  p_l = (y-y1)*t1+y*t2;
  p_h = y1*t1;
  z = p_l+p_h;
  j = HI(z);
  i = (int32_t)LO(z);
  if (j>=0x40900000) {
      if(((j-0x40900000)|i)!=0) return s*huge*huge;
      else { if(p_l+ovt>z-p_h) return s*huge*huge; }
  } else if((j&0x7fffffff)>=0x4090cc00 ) {
      if((((uint32_t)j-0xc090cc00u)|(uint32_t)i)!=0) return s*tiny*tiny;
      else { if(p_l<=z-p_h) return s*tiny*tiny; }
  }
  i = j&0x7fffffff;
  k = (i>>20)-0x3ff;
  n = 0;
  if(i>0x3fe00000) {
      n = j+(0x00100000>>(k+1));
      k = ((n&0x7fffffff)>>20)-0x3ff;
      t = zero;
      t = SET_HI(t, (n&~(0x000fffff>>k)));
      n = ((n&0x000fffff)|0x00100000)>>(20-k);
      if(j<0) n = -n;
      p_h -= t;
  }
  t = p_l+p_h;
  t = SET_LO(t,0);
  u = t*lg2_h;
  v = (p_l-(t-p_h))*lg2+t*lg2_l;
  z = u+v;
  w = v-(z-u);
  t  = z*z;
  t1  = z - t*(P1+t*(P2+t*(P3+t*(P4+t*P5))));
  r  = (z*t1)/((t1-two)-(w+z*w)); /* V8: fdlibm has (z*t1)/(t1-two)-(w+z*w) */
  z  = one-(r-z);
  j  = HI(z);
  j += (int32_t)((uint32_t)n<<20);
  if((j>>20)<=0) z = scalbn(z,n); /* subnormal output (exact) */
  else z = SET_HI(z, HI(z) + (int32_t)((uint32_t)n<<20));
  return s*z;
}

double jsm_pow(double x, double y) { return fdlibm_pow(x, y); }

int jsm_pow_is_exact(void) { return 1; }

/* Build-setting guard. `#pragma STDC FP_CONTRACT OFF` is honoured with clang's default
 * -ffp-contract=on, but -ffp-contract=fast / -ffast-math override it and fuse a*b+c into FMA
 * (measured on aarch64: 0 vs 188 fused ops in this target). An FMA-contracted a*a - c below yields
 * 2^-60 instead of 0, so this returns 0 when the C target was built with contraction. */
int jsm_fp_contract_ok(void) {
  volatile double va = 1.0 + 0x1p-30, vc = 1.0 + 0x1p-29;
  double a = va, c = vc;
  double r = a * a - c;
  return r == 0.0;
}
