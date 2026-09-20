plan "Cabin with a sleeping loft" walls 0.2/0.1 stack baixo,loft

level baixo "Ground" h2.6 ground

room sala "Living and kitchen" living rect 0,0 5x4
room banho "Shower room" wc rect 5,0 1.6x4

door sala.south w0.9 entrance
door sala>banho w0.7 swing:banho
window sala.west w1.6
window banho.east w0.6

level loft "Loft" h2.2

room dormir "Sleeping loft" bedroom rect 0,0 5x2.5
void vazio "Open to below" rect 0,2.5 5x1.5

window dormir.north w1.2

stairs escada "Ladder stair" up:180 risers:13
  at baixo in:sala rect 4,2.8 0.9x1.2
  at loft in:dormir rect 4,1.3 0.9x1.2
