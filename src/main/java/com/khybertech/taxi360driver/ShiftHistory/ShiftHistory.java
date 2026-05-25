package com.khybertech.taxi360driver.ShiftHistory;

import android.app.ProgressDialog;
import android.content.SharedPreferences;
import android.os.AsyncTask;
import android.preference.PreferenceManager;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.util.Log;
import android.widget.ListView;

import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

public class ShiftHistory extends AppCompatActivity {

    SecurePreferences pref;
    ListView lv_shifthistory;
    List<ModelShiftHistory> ls;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_shift_history);
//        pref = PreferenceManager.getDefaultSharedPreferences(ShiftHistory.this);
        pref = appcontext.getInstance().pref;
        widgets();
        ls = new ArrayList<>();
        new getShiftHistory().execute();
    }

    private void widgets() {
        lv_shifthistory = (ListView) findViewById(R.id.lv_shifthistory);
    }

    public class getShiftHistory extends AsyncTask<Void,Void,String> {
        String data="";
        ProgressDialog pd;
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(ShiftHistory.this,"Cabs Wiki","Loading!",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL(appcontext.getInstance().link);//"http://webservices.360taxitaxi.co.nz/api/DriverApp/FnDriverShiftDetails");
                String params = "DriverId="+pref.getString("user_id")+"&Month="+"12"+"&Year="+"2016";
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
                writer.write(params);
                writer.flush();
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                data = reader.readLine();
                writer.close();
                reader.close();
            }
            catch (Exception ex){
                Log.e("Taxi360taxi",ex.getMessage());
            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
            pd.dismiss();
            try {
                Log.e("history",s);
                JSONArray arr = new JSONArray(s);
                for ( int i = 0; i < arr.length(); i++){
                    JSONObject obj = arr.getJSONObject(i);
                    String ShiftDate = obj.getString("ShiftDate");
                    String ShiftStart = obj.getString("ShiftStart");
                    String ShiftEnd = obj.getString("ShiftEnd");
                    ModelShiftHistory m = new ModelShiftHistory();
                    m.setDate(ShiftDate);
                    m.setStartTime(ShiftStart);
                    m.setEndTime(ShiftEnd);
                    ls.add(m);
                }
                CustomAdapterShiftHistory adapter = new CustomAdapterShiftHistory(ShiftHistory.this,ls);
                lv_shifthistory.setAdapter(adapter);
            }
            catch (Exception ex){
                Log.e("Taxi360taxi",ex.getMessage());
            }
        }
    }
}
