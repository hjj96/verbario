/*
 * CJSMath — the JavaScript engine's Math.* reproduced bit for bit (reference engine: Node 22 / V8).
 *
 *  - fdlibm 5.3 (Sun Microsystems) for sin cos tan asin acos atan atan2 exp log log10 expm1 log1p
 *    sinh tanh: V8's src/base/ieee754.cc is a port of the same code, Node 22 matched it 0/400k
 *    (PLAN §5.2);
 *  - V8's Math.hypot algorithm (max-scaled Kahan sum, then sqrt(sum) * max);
 *  - pow: ECMAScript special cases + the exact cases (y = ±1, 2, 0.5) natively, everything else
 *    through the platform libm for now (<= 1 ulp from Node until the V8 ieee754::pow port, M0).
 *
 * Every .c file is compiled with `#pragma STDC FP_CONTRACT OFF`: no fused multiply-add anywhere,
 * otherwise clang on arm64 would contract a*b+c and break bit parity.
 * Swift code in MaydayCore never calls Foundation's sin/cos/...: only JS.sin (= jsm_sin) etc.
 */
#ifndef CJSMATH_JSMATH_H
#define CJSMATH_JSMATH_H

#ifdef __cplusplus
extern "C" {
#endif

double jsm_sin(double x);
double jsm_cos(double x);
double jsm_tan(double x);
double jsm_asin(double x);
double jsm_acos(double x);
double jsm_atan(double x);
double jsm_atan2(double y, double x);
double jsm_exp(double x);
double jsm_log(double x);
double jsm_log10(double x);
double jsm_expm1(double x);
double jsm_log1p(double x);
double jsm_sinh(double x);
double jsm_tanh(double x);

/* Math.hypot(a, b), Math.hypot(a, b, c), Math.hypot(...values) */
double jsm_hypot2(double a, double b);
double jsm_hypot3(double a, double b, double c);
double jsm_hypotn(const double *values, int count);

/* Math.pow(x, y) / x ** y */
double jsm_pow(double x, double y);

/* 1 when pow is the exact V8 port, 0 while it falls back to the platform libm (tests use this). */
int jsm_pow_is_exact(void);

#ifdef __cplusplus
}
#endif

#endif
