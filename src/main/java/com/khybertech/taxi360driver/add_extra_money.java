package com.khybertech.taxi360driver;

import android.content.Intent;
import android.os.Bundle;
import android.support.v7.app.AppCompatActivity;
import android.view.View;
import android.view.Window;
import android.widget.TextView;

public class add_extra_money extends AppCompatActivity {
    TextView  btn_done;
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        this.requestWindowFeature(Window.FEATURE_NO_TITLE);
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_add_extra_money);

        setFinishOnTouchOutside(false);


        btn_done = (TextView)findViewById(R.id.done);
        (btn_done).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                Intent goBack = new Intent();
                goBack.putExtra("money", ((TextView)findViewById(R.id.password_field)).getText()+"");
                setResult(RESULT_OK, goBack);
                finish();
            }
        });


    }

    @Override
    public void onBackPressed() {
       // super.onBackPressed();
       // btn_done.performLongClick();
        Intent goBack = new Intent();
        goBack.putExtra("money", ((TextView)findViewById(R.id.password_field)).getText()+"");
        setResult(RESULT_OK, goBack);
        finish();
    }
}
