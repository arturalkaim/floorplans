plan "Shop" walls 0.3/0.12

room loja "Shop floor" other day rect 0,0 7x6
room armazem "Storeroom" storage work rect 0,6 5x3
room wc "Staff WC" wc work rect 5,6 2x3

door loja.north w1.2 entrance glazed
cased loja>armazem w1
door armazem>wc w0.7 swing:wc
window loja.west w2.4
window armazem.south w1
window wc.east w0.5

fixture wc in:wc at 5.3,6.3 size 0.4x0.7
