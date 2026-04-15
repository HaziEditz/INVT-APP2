package com.khybertech.taxi360driver.MainActivity;

import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Bundle;
import android.os.CountDownTimer;
import android.view.View;
import android.widget.Button;

import com.khybertech.taxi360driver.R;

public class RideCancel extends BaseActivity {

    CountDownTimer countDownTimer;
    ToneGenerator toneGen1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_ride_cancel);

        ((Button)findViewById(R.id.okay)).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });


                            toneGen1 = new ToneGenerator(AudioManager.STREAM_MUSIC, 150);
                            toneGen1.startTone(ToneGenerator.TONE_CDMA_NETWORK_BUSY, 15000);





    }

    @Override
    public void onStop() {
        super.onStop();

    }

    @Override
    protected void onDestroy() {
        super.onDestroy();

        try{
            toneGen1.stopTone();
            toneGen1.release();
        }catch (Exception e){
            e.printStackTrace();
        }
    }

}
